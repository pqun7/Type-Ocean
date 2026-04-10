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

  // Run the streak update inside a transaction so concurrent requests are safe.
  const result = await db.transaction(async (tx) => {
    // Ensure the rating row exists (upsert default) and lock it for update.
    // Drizzle neon-http does not support SELECT FOR UPDATE, so we use
    // onConflictDoNothing + a subsequent update — a safe pattern for low contention.
    await tx
      .insert(pvpRatings)
      .values({ userId })
      .onConflictDoNothing({ target: pvpRatings.userId });

    const rows = await tx
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
    if (!current) return null;

    // Idempotency: same matchId was already processed — return current state
    if (current.lastStreakMatchId === matchId) {
      return {
        currentStreak: current.currentStreak,
        longestStreak: current.longestStreak,
        streakBonus: 0,
        newRating: current.rating,
        idempotent: true,
      };
    }

    const newStreak = isWin ? current.currentStreak + 1 : 0;
    const newLongest = Math.max(current.longestStreak, newStreak);
    const streakBonus = isWin ? getStreakBonus(newStreak) : 0;
    const newRating = current.rating + streakBonus;

    // Apply ELO bonus if earned
    if (streakBonus > 0) {
      await tx
        .insert(pvpRatingChanges)
        .values({
          matchId,
          userId,
          beforeRating: current.rating,
          afterRating: newRating,
          delta: streakBonus,
        });
    }

    await tx
      .update(pvpRatings)
      .set({
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastStreakMatchId: matchId,
        rating: newRating,
        updatedAt: sql`now()`,
      })
      .where(eq(pvpRatings.userId, userId));

    return { currentStreak: newStreak, longestStreak: newLongest, streakBonus, newRating, idempotent: false };
  });

  if (!result) {
    return NextResponse.json({ error: "Rating row not found" }, { status: 500, headers: rateLimit.headers });
  }

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
