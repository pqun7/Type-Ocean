export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { pvpRatings, pvpRatingChanges } from "@/db/schema";
import { authorizeRequest } from "@/app/api/shared.server";
import { rateLimiter } from "@/lib/rate-limiter";
import { invalidateCachedPvpSelf } from "@/features/pvp/server/pvp-self-cache";

// ── Progressive streak ELO bonus (additive, server-only, ranked 1v1 only) ──
const STREAK_ELO_BONUS: Array<{ minStreak: number; bonus: number }> = [
  { minStreak: 20, bonus: 25 },
  { minStreak: 12, bonus: 20 },
  { minStreak: 8,  bonus: 15 },
  { minStreak: 5,  bonus: 10 },
  { minStreak: 3,  bonus: 5  },
  { minStreak: 0,  bonus: 0  },
];

function getStreakBonus(streak: number): number {
  return STREAK_ELO_BONUS.find((t) => streak >= t.minStreak)?.bonus ?? 0;
}

// Basic UUID v4 check — guards against injection via matchId
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/streak/record:POST");
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  let matchId: string;
  try {
    const body = await req.json() as unknown;
    if (typeof body !== "object" || body === null || typeof (body as Record<string, unknown>).matchId !== "string") {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400, headers: rateLimit.headers });
    }
    matchId = (body as { matchId: string }).matchId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: rateLimit.headers });
  }

  if (!UUID_RE.test(matchId)) {
    return NextResponse.json({ error: "Invalid matchId" }, { status: 400, headers: rateLimit.headers });
  }

  // Verify this is a ranked 1v1 match by checking for a rating-change record.
  // The gateway writes pvpRatingChanges rows only for ranked matches.
  const changeRows = await db
    .select({ delta: pvpRatingChanges.delta })
    .from(pvpRatingChanges)
    .where(and(eq(pvpRatingChanges.matchId, matchId), eq(pvpRatingChanges.userId, userId)))
    .limit(1);

  if (changeRows.length === 0) {
    // Not a ranked match (or user was not a participant) — no streak update
    return NextResponse.json({ error: "not_ranked" }, { status: 400, headers: rateLimit.headers });
  }

  const isWin = changeRows[0].delta > 0;

  // neon-http does not support transactions, so we run sequential queries with
  // an atomic conditional UPDATE (WHERE lastStreakMatchId IS DISTINCT FROM matchId)
  // as the idempotency guard — safe for the low-contention single-user-per-match case.

  // 1. Ensure the rating row exists.
  await db
    .insert(pvpRatings)
    .values({ userId })
    .onConflictDoNothing({ target: pvpRatings.userId });

  // 2. Read current state.
  const rows = await db
    .select({
      rating: pvpRatings.rating,
      currentStreak: pvpRatings.currentStreak,
      longestStreak: pvpRatings.longestStreak,
      lastStreakMatchId: pvpRatings.lastStreakMatchId,
    })
    .from(pvpRatings)
    .where(eq(pvpRatings.userId, userId))
    .limit(1);

  const current = rows[0];
  if (!current) {
    return NextResponse.json({ error: "Rating row not found" }, { status: 500, headers: rateLimit.headers });
  }

  // 3. Fast-path idempotency: already processed this match.
  if (current.lastStreakMatchId === matchId) {
    await invalidateCachedPvpSelf(userId);
    return NextResponse.json(
      {
        currentStreak: current.currentStreak,
        longestStreak: current.longestStreak,
        streakBonus: 0,
        newRating: current.rating,
      },
      { headers: rateLimit.headers },
    );
  }

  const newStreak = isWin ? current.currentStreak + 1 : 0;
  const newLongest = Math.max(current.longestStreak, newStreak);
  const streakBonus = isWin ? getStreakBonus(newStreak) : 0;
  const newRating = current.rating + streakBonus;

  // 4. Atomic conditional update: only applies when this match has not yet been recorded.
  //    IS DISTINCT FROM handles the NULL case correctly.
  const updated = await db
    .update(pvpRatings)
    .set({
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastStreakMatchId: matchId,
      rating: newRating,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(pvpRatings.userId, userId),
        sql`${pvpRatings.lastStreakMatchId} IS DISTINCT FROM ${matchId}`,
      ),
    )
    .returning({ currentStreak: pvpRatings.currentStreak });

  if (updated.length === 0) {
    // A concurrent request already processed this matchId — return fresh state.
    const fresh = await db
      .select({ rating: pvpRatings.rating, currentStreak: pvpRatings.currentStreak, longestStreak: pvpRatings.longestStreak })
      .from(pvpRatings)
      .where(eq(pvpRatings.userId, userId))
      .limit(1);
    await invalidateCachedPvpSelf(userId);
    return NextResponse.json(
      {
        currentStreak: fresh[0]?.currentStreak ?? 0,
        longestStreak: fresh[0]?.longestStreak ?? 0,
        streakBonus: 0,
        newRating: fresh[0]?.rating ?? current.rating,
      },
      { headers: rateLimit.headers },
    );
  }

  // 5. Insert streak bonus rating-change record (onConflictDoNothing for safety).
  if (streakBonus > 0) {
    await db
      .insert(pvpRatingChanges)
      .values({
        matchId,
        userId,
        beforeRating: current.rating,
        afterRating: newRating,
        delta: streakBonus,
      })
      .onConflictDoNothing();
  }

  const result = { currentStreak: newStreak, longestStreak: newLongest, streakBonus, newRating };

  // Invalidate the 30-second Redis cache so the next /api/pvp/me fetch is fresh
  await invalidateCachedPvpSelf(userId);

  return NextResponse.json(
    {
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
      streakBonus: result.streakBonus,
      newRating: result.newRating,
    },
    { headers: rateLimit.headers },
  );
}
