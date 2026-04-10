// src/app/api/internal/pvp-stats/route.ts
// Internal endpoint: PvP gateway POSTs match stats here after a match finishes.
// Auth: Bearer ${INTERNAL_STATS_SECRET}
// Idempotency: Redis key "pvp:stats:processed:{matchId}" (NX, 24h TTL)
// At-least-once: failed Lua writes are saved to pvpFailedStats, drained lazily.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, lte, sql } from "drizzle-orm";
import { connectIfNeeded, redis } from "@/lib/redis";
import { db } from "@/db";
import { pvpFailedStats } from "@/db/schema";
import { updateLongTermCumulativeStats } from "@/helper/session-stats";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParticipantPayload {
  userId: string;
  wpm: number;
  accuracy: number;
  timeMs: number;
  textLength: number;
  errors: number;
  completedAt: string; // ISO-8601
}

interface PvpStatsPayload {
  matchId: string;
  participants: ParticipantPayload[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 h
const MAX_DRAIN_PER_REQUEST = 5;
const MAX_RETRY_COUNT = 10;

/** Exponential backoff: 5s, 30s, 2m, 10m, … capped at 2h */
function nextRetryDelay(retryCount: number): number {
  return Math.min(5_000 * Math.pow(4, retryCount), 7_200_000);
}

async function processParticipant(p: ParticipantPayload): Promise<void> {
  await updateLongTermCumulativeStats(p.userId, {
    wpm: p.wpm,
    accuracy: p.accuracy,
    timeSpent: Math.round(p.timeMs / 1000),
    textLength: p.textLength,
    mistakes: p.errors,
    corrections: 0,
    language: "en",
    mode: "pvp",
  });
}

/** Write one failed-stats row for every participant that couldn't be processed. */
async function recordFailures(
  matchId: string,
  participants: ParticipantPayload[],
  errorMessage: string,
): Promise<void> {
  if (participants.length === 0) return;
  try {
    await db.insert(pvpFailedStats).values(
      participants.map((p) => ({
        matchId,
        userId: p.userId,
        wpm: p.wpm,
        accuracy: p.accuracy,
        timeMs: p.timeMs,
        textLength: p.textLength,
        errors: p.errors,
        completedAt: new Date(p.completedAt),
        retryCount: 0,
        nextRetryAt: new Date(),
        lastError: errorMessage.slice(0, 500),
      })),
    );
  } catch {
    // Best-effort — nothing more we can do if the DB is also down
  }
}

/** Lazily drain up to `limit` overdue failed-stats rows. Fire-and-forget. */
async function drainFailedStats(limit: number): Promise<void> {
  let rows: (typeof pvpFailedStats.$inferSelect)[];
  try {
    rows = await db
      .select()
      .from(pvpFailedStats)
      .where(
        and(
          lte(pvpFailedStats.nextRetryAt, new Date()),
          lte(pvpFailedStats.retryCount, MAX_RETRY_COUNT),
        ),
      )
      .limit(limit);
  } catch {
    return;
  }

  for (const row of rows) {
    try {
      await processParticipant({
        userId: row.userId,
        wpm: row.wpm,
        accuracy: row.accuracy,
        timeMs: row.timeMs,
        textLength: row.textLength,
        errors: row.errors,
        completedAt: row.completedAt.toISOString(),
      });
      await db.delete(pvpFailedStats).where(sql`${pvpFailedStats.id} = ${row.id}`);
    } catch (err) {
      const newRetryCount = row.retryCount + 1;
      const delay = nextRetryDelay(newRetryCount);
      try {
        await db
          .update(pvpFailedStats)
          .set({
            retryCount: newRetryCount,
            nextRetryAt: new Date(Date.now() + delay),
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          })
          .where(sql`${pvpFailedStats.id} = ${row.id}`);
      } catch {
        // Ignore update failure
      }
    }
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth
  const secret = process.env.INTERNAL_STATS_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Stats endpoint not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let payload: PvpStatsPayload;
  try {
    payload = (await req.json()) as PvpStatsPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { matchId, participants } = payload;
  if (!matchId || !Array.isArray(participants) || participants.length === 0) {
    return NextResponse.json({ error: "Missing matchId or participants" }, { status: 400 });
  }

  // 3. Idempotency — skip if already processed
  try {
    await connectIfNeeded();
    const key = `pvp:stats:processed:${matchId}`;
    const set = await redis.set(key, "1", "EX", IDEMPOTENCY_TTL_SECONDS, "NX");
    if (set === null) {
      // Already processed — still fire drain, then return success
      drainFailedStats(MAX_DRAIN_PER_REQUEST).catch(() => undefined);
      return NextResponse.json({ ok: true, skipped: true });
    }
  } catch {
    // Redis unavailable — proceed anyway (stats must not be silently lost)
  }

  // 4. Process each participant
  const failed: ParticipantPayload[] = [];
  for (const p of participants) {
    try {
      await processParticipant(p);
    } catch {
      failed.push(p);
    }
  }

  // 5. Persist any failures for later retry
  if (failed.length > 0) {
    await recordFailures(
      matchId,
      failed,
      `Initial processing failure for match ${matchId}`,
    );
  }

  // 6. Lazy drain — fire and forget
  drainFailedStats(MAX_DRAIN_PER_REQUEST).catch(() => undefined);

  return NextResponse.json({ ok: true, processed: participants.length - failed.length, failed: failed.length });
}
