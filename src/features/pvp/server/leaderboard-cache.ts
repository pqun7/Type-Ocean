import { asc, count, desc, eq } from "drizzle-orm";

import { db, transactionDb } from "@/db";
import { leaderboardSnapshotMeta, leaderboardSnapshots, playerProfiles } from "@/db/schema";
import { getRankInfo } from "@/features/ranking/rating";
import { connectIfNeeded, redis } from "@/lib/redis";

const LEADERBOARD_SNAPSHOT_KEY = "global";
const LEADERBOARD_CACHE_VERSION_KEY = "leaderboard:global:cache_version";
const LEADERBOARD_PAGE_CACHE_PREFIX = "leaderboard:global:page";
const LEADERBOARD_REFRESH_LOCK_KEY = "leaderboard:global:refresh_lock";
const LEADERBOARD_PAGE_CACHE_TTL_SECONDS = 300;
const LEADERBOARD_REFRESH_LOCK_TTL_SECONDS = 30;
const LEADERBOARD_SNAPSHOT_REFRESH_MS = envMs("LEADERBOARD_SNAPSHOT_REFRESH_MS", 60_000);

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, duration: number, policy?: string): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
};

type LeaderboardEntry = {
  position: number;
  userId: string;
  username: string;
  avatar: string | null;
  rating: number;
  tier: ReturnType<typeof getRankInfo>["tier"];
  updatedAt: string | null;
  classified: boolean;
};

type CachedLeaderboardPage = {
  v: 2;
  result: LeaderboardPageResult;
};

type SnapshotMeta = {
  rowCount: number;
  refreshedAt: Date | null;
  stale: boolean;
};

export type LeaderboardPageResult = {
  limit: number;
  offset: number;
  totalRanked: number;
  cutoff: number;
  entries: LeaderboardEntry[];
};

function envMs(name: string, fallbackMs: number) {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallbackMs;
}

function getLeaderboardPageCacheKey(limit: number, offset: number, version: number) {
  return `${LEADERBOARD_PAGE_CACHE_PREFIX}:${version}:${offset}:${limit}`;
}

function normalizeCachedLeaderboardPage(raw: string): LeaderboardPageResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CachedLeaderboardPage>;
    if (parsed.v !== 2 || !parsed.result) return null;

    const result = parsed.result as Partial<LeaderboardPageResult>;
    if (typeof result.limit !== "number") return null;
    if (typeof result.offset !== "number") return null;
    if (typeof result.totalRanked !== "number") return null;
    if (typeof result.cutoff !== "number") return null;
    if (!Array.isArray(result.entries)) return null;

    return result as LeaderboardPageResult;
  } catch {
    return null;
  }
}

function buildLeaderboardEntries(params: {
  offset: number;
  totalRanked: number;
  rows: Array<{
    position: number;
    userId: string;
    username: string;
    avatar: string | null;
    rating: number;
    updatedAt: Date | string | null;
  }>;
}): LeaderboardEntry[] {
  const cutoff = Math.max(1, Math.ceil(params.totalRanked * 0.01));

  return params.rows.map((row, index) => {
    const position = row.position || params.offset + index + 1;
    const updatedAt =
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : typeof row.updatedAt === "string"
          ? row.updatedAt
          : null;

    return {
      position,
      userId: row.userId,
      username: row.username,
      avatar: row.avatar,
      rating: row.rating,
      tier: getRankInfo(row.rating).tier,
      updatedAt,
      classified: position <= cutoff,
    };
  });
}

function buildLeaderboardPageResult(params: {
  limit: number;
  offset: number;
  totalRanked: number;
  rows: Array<{
    position: number;
    userId: string;
    username: string;
    avatar: string | null;
    rating: number;
    updatedAt: Date | string | null;
  }>;
}): LeaderboardPageResult {
  return {
    limit: params.limit,
    offset: params.offset,
    totalRanked: params.totalRanked,
    cutoff: Math.max(1, Math.ceil(params.totalRanked * 0.01)),
    entries: buildLeaderboardEntries({
      offset: params.offset,
      totalRanked: params.totalRanked,
      rows: params.rows,
    }),
  };
}

function isSnapshotFresh(meta: SnapshotMeta | null, nowMs = Date.now()) {
  if (!meta || meta.stale || !meta.refreshedAt) return false;
  return nowMs - meta.refreshedAt.getTime() <= LEADERBOARD_SNAPSHOT_REFRESH_MS;
}

async function withRedis<T>(fn: (client: RedisLike) => Promise<T>) {
  try {
    await connectIfNeeded();
    return await fn(redis as unknown as RedisLike);
  } catch {
    return null;
  }
}

async function readCacheVersion(redisClient?: RedisLike) {
  const reader = async (client: RedisLike) => {
    const raw = await client.get(LEADERBOARD_CACHE_VERSION_KEY);
    const parsed = Number(raw ?? "0");
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  };

  if (redisClient) {
    return reader(redisClient);
  }

  return (await withRedis(reader)) ?? 0;
}

async function bumpCacheVersion(redisClient?: RedisLike) {
  const writer = async (client: RedisLike) => {
    await client.incr(LEADERBOARD_CACHE_VERSION_KEY);
  };

  if (redisClient) {
    await writer(redisClient);
    return;
  }

  await withRedis(writer);
}

export async function readLeaderboardPageFromCache(params: {
  limit: number;
  offset: number;
  redisClient?: RedisLike;
  cacheVersion?: number;
}) {
  const reader = async (client: RedisLike) => {
    const version = params.cacheVersion ?? (await readCacheVersion(client));
    const raw = await client.get(getLeaderboardPageCacheKey(params.limit, params.offset, version));
    if (!raw) return null;
    return normalizeCachedLeaderboardPage(raw);
  };

  if (params.redisClient) {
    return reader(params.redisClient);
  }

  return withRedis(reader);
}

async function writeLeaderboardPageToCache(params: {
  result: LeaderboardPageResult;
  redisClient?: RedisLike;
  cacheVersion?: number;
}) {
  const writer = async (client: RedisLike) => {
    const version = params.cacheVersion ?? (await readCacheVersion(client));
    await client.setex(
      getLeaderboardPageCacheKey(params.result.limit, params.result.offset, version),
      LEADERBOARD_PAGE_CACHE_TTL_SECONDS,
      JSON.stringify({ v: 2, result: params.result } satisfies CachedLeaderboardPage)
    );
  };

  if (params.redisClient) {
    await writer(params.redisClient);
    return;
  }

  await withRedis(writer);
}

async function readSnapshotMeta(): Promise<SnapshotMeta | null> {
  const rows = await db
    .select({
      rowCount: leaderboardSnapshotMeta.rowCount,
      refreshedAt: leaderboardSnapshotMeta.refreshedAt,
      stale: leaderboardSnapshotMeta.stale,
    })
    .from(leaderboardSnapshotMeta)
    .where(eq(leaderboardSnapshotMeta.snapshotKey, LEADERBOARD_SNAPSHOT_KEY))
    .limit(1);

  const meta = rows[0] ?? null;

  if (!meta) return null;

  return {
    rowCount: meta.rowCount,
    refreshedAt: meta.refreshedAt,
    stale: meta.stale,
  };
}

async function readSnapshotPage(params: {
  limit: number;
  offset: number;
  meta: SnapshotMeta;
}): Promise<LeaderboardPageResult | null> {
  if (params.meta.rowCount === 0) {
    return buildLeaderboardPageResult({
      limit: params.limit,
      offset: params.offset,
      totalRanked: 0,
      rows: [],
    });
  }

  const rows = await db
    .select({
      position: leaderboardSnapshots.position,
      userId: leaderboardSnapshots.userId,
      username: leaderboardSnapshots.username,
      avatar: leaderboardSnapshots.avatar,
      rating: leaderboardSnapshots.rating,
      updatedAt: leaderboardSnapshots.updatedAt,
    })
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.snapshotKey, LEADERBOARD_SNAPSHOT_KEY))
    .orderBy(asc(leaderboardSnapshots.position))
    .offset(params.offset)
    .limit(params.limit);

  const expected = Math.max(0, Math.min(params.limit, params.meta.rowCount - params.offset));
  if (expected > 0 && rows.length !== expected) {
    return null;
  }

  return buildLeaderboardPageResult({
    limit: params.limit,
    offset: params.offset,
    totalRanked: params.meta.rowCount,
    rows,
  });
}

async function readLiveLeaderboardPage(params: {
  limit: number;
  offset: number;
}): Promise<LeaderboardPageResult> {
  const [countRows, profiles] = await Promise.all([
    db
      .select({ value: count() })
      .from(playerProfiles)
      .where(eq(playerProfiles.hideFromLeaderboard, false)),
    db
      .select({
        userId: playerProfiles.userId,
        username: playerProfiles.username,
        avatar: playerProfiles.avatar,
        rating: playerProfiles.rating,
        ratingUpdatedAt: playerProfiles.ratingUpdatedAt,
        updatedAt: playerProfiles.updatedAt,
      })
      .from(playerProfiles)
      .where(eq(playerProfiles.hideFromLeaderboard, false))
      .orderBy(desc(playerProfiles.rating), desc(playerProfiles.ratingUpdatedAt), desc(playerProfiles.updatedAt))
      .offset(params.offset)
      .limit(params.limit),
  ]);

  const totalRanked = Number(countRows[0]?.value ?? 0);

  return buildLeaderboardPageResult({
    limit: params.limit,
    offset: params.offset,
    totalRanked,
    rows: profiles.map((profile, index) => ({
      position: params.offset + index + 1,
      userId: profile.userId,
      username: profile.username,
      avatar: profile.avatar,
      rating: profile.rating,
      updatedAt: profile.ratingUpdatedAt ?? profile.updatedAt,
    })),
  });
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function refreshLeaderboardSnapshot() {
  const profiles = await db
    .select({
      userId: playerProfiles.userId,
      username: playerProfiles.username,
      avatar: playerProfiles.avatar,
      rating: playerProfiles.rating,
      ratingUpdatedAt: playerProfiles.ratingUpdatedAt,
      updatedAt: playerProfiles.updatedAt,
    })
    .from(playerProfiles)
    .where(eq(playerProfiles.hideFromLeaderboard, false))
    .orderBy(desc(playerProfiles.rating), desc(playerProfiles.ratingUpdatedAt), desc(playerProfiles.updatedAt));

  const refreshedAt = new Date();
  const snapshotRows = profiles.map((profile, index) => ({
    snapshotKey: LEADERBOARD_SNAPSHOT_KEY,
    userId: profile.userId,
    position: index + 1,
    username: profile.username,
    avatar: profile.avatar,
    rating: profile.rating,
    updatedAt: profile.ratingUpdatedAt ?? profile.updatedAt,
    refreshedAt,
  }));

  await transactionDb.transaction(async (tx) => {
    await tx.delete(leaderboardSnapshots).where(eq(leaderboardSnapshots.snapshotKey, LEADERBOARD_SNAPSHOT_KEY));

    for (const chunk of chunkRows(snapshotRows, 500)) {
      if (chunk.length === 0) continue;
      await tx.insert(leaderboardSnapshots).values(chunk);
    }

    await tx
      .insert(leaderboardSnapshotMeta)
      .values({
        snapshotKey: LEADERBOARD_SNAPSHOT_KEY,
        refreshedAt,
        rowCount: snapshotRows.length,
        stale: false,
      })
      .onConflictDoUpdate({
        target: leaderboardSnapshotMeta.snapshotKey,
        set: {
          refreshedAt,
          rowCount: snapshotRows.length,
          stale: false,
          updatedAt: new Date(),
        },
      });
  });

  await bumpCacheVersion();
}

const localRefreshState = {
  active: false,
};

async function tryAcquireRefreshLock() {
  return withRedis(async (client) => {
    const result = await client.set(
      LEADERBOARD_REFRESH_LOCK_KEY,
      String(Date.now()),
      "EX",
      LEADERBOARD_REFRESH_LOCK_TTL_SECONDS,
      "NX"
    );
    return result === "OK";
  });
}

export async function requestLeaderboardSnapshotRefresh() {
  if (localRefreshState.active) return false;

  const meta = await readSnapshotMeta();
  if (isSnapshotFresh(meta)) return false;

  localRefreshState.active = true;
  void (async () => {
    try {
      const acquired = await tryAcquireRefreshLock();
      if (acquired === false) return;
      await refreshLeaderboardSnapshot();
    } catch {
      // ignore refresh failures; live fallback remains available
    } finally {
      localRefreshState.active = false;
    }
  })();

  return true;
}

async function markLeaderboardSnapshotStale() {
  await db
    .insert(leaderboardSnapshotMeta)
    .values({
      snapshotKey: LEADERBOARD_SNAPSHOT_KEY,
      stale: true,
    })
    .onConflictDoUpdate({
      target: leaderboardSnapshotMeta.snapshotKey,
      set: {
        stale: true,
        updatedAt: new Date(),
      },
    });

  await bumpCacheVersion();
}

export async function refreshLeaderboardProfileCache(_userId: string) {
  await markLeaderboardSnapshotStale();
  await requestLeaderboardSnapshotRefresh();
}

export async function getLeaderboardPage(params: {
  limit: number;
  offset: number;
}): Promise<LeaderboardPageResult> {
  const cacheVersion = await readCacheVersion();
  const cached = await readLeaderboardPageFromCache({
    limit: params.limit,
    offset: params.offset,
    cacheVersion,
  });
  if (cached) {
    return cached;
  }

  const meta = await readSnapshotMeta();
  if (isSnapshotFresh(meta)) {
    const snapshotPage = await readSnapshotPage({
      limit: params.limit,
      offset: params.offset,
      meta: meta!,
    });

    if (snapshotPage) {
      await writeLeaderboardPageToCache({ result: snapshotPage, cacheVersion });
      return snapshotPage;
    }
  }

  await requestLeaderboardSnapshotRefresh();

  const livePage = await readLiveLeaderboardPage(params);
  await writeLeaderboardPageToCache({ result: livePage, cacheVersion });
  return livePage;
}

export const __leaderboardTestUtils = {
  buildLeaderboardEntries,
  buildLeaderboardPageResult,
  getLeaderboardPageCacheKey,
  isSnapshotFresh,
};
