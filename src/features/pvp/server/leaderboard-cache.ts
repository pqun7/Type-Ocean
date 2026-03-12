import prisma from "@/features/auth/lib/db";
import { connectIfNeeded, redis } from "@/lib/redis";
import { getRankInfo } from "@/features/ranking/rating";

const LEADERBOARD_ZSET_KEY = "leaderboard:global";
const LEADERBOARD_TOTAL_KEY = "leaderboard:global:total";
const LEADERBOARD_ENTRY_TTL_SECONDS = 600;
const LEADERBOARD_TOTAL_TTL_SECONDS = 600;
const LEADERBOARD_SCORE_FACTOR = 10_000_000_000;

type RedisLike = {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
};

type LeaderboardProfileRecord = {
  userId: string;
  username: string;
  avatar: string | null;
  rating: number;
  ratingUpdatedAt: Date | null;
  updatedAt: Date;
  hideFromLeaderboard?: boolean;
};

type CachedLeaderboardProfile = {
  v: 1;
  userId: string;
  username: string;
  avatar: string | null;
  rating: number;
  sortTimestampMs: number;
  updatedAt: string | null;
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

export type LeaderboardPageResult = {
  limit: number;
  offset: number;
  totalRanked: number;
  cutoff: number;
  entries: LeaderboardEntry[];
};

function getLeaderboardEntryKey(userId: string) {
  return `leaderboard:entry:${userId}`;
}

function getSortTimestampMs(profile: LeaderboardProfileRecord) {
  const sortDate = profile.ratingUpdatedAt ?? profile.updatedAt;
  return sortDate.getTime();
}

export function buildLeaderboardScore(rating: number, sortTimestampMs: number) {
  return rating * LEADERBOARD_SCORE_FACTOR + Math.floor(sortTimestampMs / 1000);
}

function serializeLeaderboardProfile(profile: LeaderboardProfileRecord): CachedLeaderboardProfile {
  const updatedAt = profile.ratingUpdatedAt ?? profile.updatedAt;
  return {
    v: 1,
    userId: profile.userId,
    username: profile.username,
    avatar: profile.avatar,
    rating: profile.rating,
    sortTimestampMs: updatedAt.getTime(),
    updatedAt: updatedAt.toISOString(),
  };
}

function parseLeaderboardProfile(raw: string): CachedLeaderboardProfile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CachedLeaderboardProfile>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.userId !== "string") return null;
    if (typeof parsed.username !== "string") return null;
    if (typeof parsed.rating !== "number") return null;
    if (typeof parsed.sortTimestampMs !== "number") return null;

    return {
      v: 1,
      userId: parsed.userId,
      username: parsed.username,
      avatar: typeof parsed.avatar === "string" ? parsed.avatar : null,
      rating: parsed.rating,
      sortTimestampMs: parsed.sortTimestampMs,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function toLeaderboardEntries(params: {
  offset: number;
  totalRanked: number;
  profiles: CachedLeaderboardProfile[];
}): LeaderboardEntry[] {
  const cutoff = Math.max(1, Math.ceil(params.totalRanked * 0.01));
  return params.profiles.map((profile, index) => {
    const position = params.offset + index + 1;
    return {
      position,
      userId: profile.userId,
      username: profile.username,
      avatar: profile.avatar,
      rating: profile.rating,
      tier: getRankInfo(profile.rating).tier,
      updatedAt: profile.updatedAt,
      classified: position <= cutoff,
    };
  });
}

async function withRedis<T>(fn: (client: RedisLike) => Promise<T>) {
  try {
    await connectIfNeeded();
    return await fn(redis as unknown as RedisLike);
  } catch {
    return null;
  }
}

export async function readLeaderboardPageFromCache(params: {
  limit: number;
  offset: number;
  redisClient?: RedisLike;
}) {
  const reader = async (client: RedisLike) => {
    const totalRaw = await client.get(LEADERBOARD_TOTAL_KEY);
    if (!totalRaw) return null;

    const totalRanked = Number(totalRaw);
    if (!Number.isFinite(totalRanked) || totalRanked < 0) return null;

    if (totalRanked === 0) {
      return {
        limit: params.limit,
        offset: params.offset,
        totalRanked: 0,
        cutoff: 1,
        entries: [],
      } satisfies LeaderboardPageResult;
    }

    const ids = await client.zrevrange(LEADERBOARD_ZSET_KEY, params.offset, params.offset + params.limit - 1);
    const expected = Math.max(0, Math.min(params.limit, totalRanked - params.offset));
    if (expected > 0 && ids.length !== expected) return null;

    const profiles: CachedLeaderboardProfile[] = [];
    for (const userId of ids) {
      const raw = await client.get(getLeaderboardEntryKey(userId));
      if (!raw) return null;

      const parsed = parseLeaderboardProfile(raw);
      if (!parsed) return null;
      profiles.push(parsed);
    }

    const cutoff = Math.max(1, Math.ceil(totalRanked * 0.01));
    return {
      limit: params.limit,
      offset: params.offset,
      totalRanked,
      cutoff,
      entries: toLeaderboardEntries({
        offset: params.offset,
        totalRanked,
        profiles,
      }),
    } satisfies LeaderboardPageResult;
  };

  if (params.redisClient) {
    return reader(params.redisClient);
  }
  return withRedis(reader);
}

export async function upsertLeaderboardProfileCache(profile: LeaderboardProfileRecord, redisClient?: RedisLike) {
  const writer = async (client: RedisLike) => {
    if (profile.hideFromLeaderboard) {
      await client.zrem(LEADERBOARD_ZSET_KEY, profile.userId);
      await client.del(getLeaderboardEntryKey(profile.userId));
      return;
    }

    const score = buildLeaderboardScore(profile.rating, getSortTimestampMs(profile));
    const payload = JSON.stringify(serializeLeaderboardProfile(profile));
    await client.zadd(LEADERBOARD_ZSET_KEY, score, profile.userId);
    await client.setex(getLeaderboardEntryKey(profile.userId), LEADERBOARD_ENTRY_TTL_SECONDS, payload);
  };

  if (redisClient) {
    await writer(redisClient);
    return;
  }
  await withRedis(writer);
}

export async function primeLeaderboardPageCache(params: {
  totalRanked: number;
  profiles: LeaderboardProfileRecord[];
  redisClient?: RedisLike;
}) {
  const writer = async (client: RedisLike) => {
    await client.setex(LEADERBOARD_TOTAL_KEY, LEADERBOARD_TOTAL_TTL_SECONDS, String(params.totalRanked));
    for (const profile of params.profiles) {
      await upsertLeaderboardProfileCache(profile, client);
    }
  };

  if (params.redisClient) {
    await writer(params.redisClient);
    return;
  }
  await withRedis(writer);
}

export async function refreshLeaderboardProfileCache(userId: string) {
  const profile = await prisma.playerProfile.findUnique({
    where: { userId },
    select: {
      userId: true,
      username: true,
      avatar: true,
      rating: true,
      ratingUpdatedAt: true,
      updatedAt: true,
      hideFromLeaderboard: true,
    },
  });

  if (!profile) {
    await withRedis(async (client) => {
      await client.del(LEADERBOARD_TOTAL_KEY);
      await client.zrem(LEADERBOARD_ZSET_KEY, userId);
      await client.del(getLeaderboardEntryKey(userId));
    });
    return;
  }

  await withRedis(async (client) => {
    await client.del(LEADERBOARD_TOTAL_KEY);
  });
  await upsertLeaderboardProfileCache(profile);
}

export async function getLeaderboardPage(params: { limit: number; offset: number }): Promise<LeaderboardPageResult> {
  const cached = await readLeaderboardPageFromCache(params);
  if (cached) return cached;

  const [totalRanked, profiles] = await Promise.all([
    prisma.playerProfile.count({ where: { hideFromLeaderboard: false } }),
    prisma.playerProfile.findMany({
      where: { hideFromLeaderboard: false },
      orderBy: [{ rating: "desc" }, { ratingUpdatedAt: "desc" }, { updatedAt: "desc" }],
      take: params.limit,
      skip: params.offset,
      select: {
        userId: true,
        username: true,
        avatar: true,
        rating: true,
        ratingUpdatedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  await primeLeaderboardPageCache({ totalRanked, profiles });

  const cutoff = Math.max(1, Math.ceil(totalRanked * 0.01));
  return {
    limit: params.limit,
    offset: params.offset,
    totalRanked,
    cutoff,
    entries: toLeaderboardEntries({
      offset: params.offset,
      totalRanked,
      profiles: profiles.map((profile) => serializeLeaderboardProfile(profile)),
    }),
  };
}