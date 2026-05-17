export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq, sql as rawSql } from "drizzle-orm";

import { db } from "@/db";
import { playerProfiles, pvpRatings } from "@/db/schema";
import { authorizeRequest } from "@/app/api/shared.server";
import { getPvpRankInfo } from "@/features/pvp/rank";
import { rateLimiter } from "@/lib/rate-limiter";
import { readCachedPvpSelf, writeCachedPvpSelf } from "@/features/pvp/server/pvp-self-cache";

export async function GET(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/me:GET");
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  const cached = await readCachedPvpSelf(userId);
  if (cached) {
    return NextResponse.json(cached, { headers: rateLimit.headers });
  }

  await db.insert(pvpRatings).values({ userId }).onConflictDoNothing({ target: pvpRatings.userId });

  const ratingRows = await db
    .select({
      rating: pvpRatings.rating,
      deviation: pvpRatings.deviation,
      gamesPlayed: pvpRatings.gamesPlayed,
      currentStreak: pvpRatings.currentStreak,
      updatedAt: pvpRatings.updatedAt,
      level: playerProfiles.level,
    })
    .from(pvpRatings)
    .leftJoin(playerProfiles, eq(pvpRatings.userId, playerProfiles.userId))
    .where(eq(pvpRatings.userId, userId))
    .limit(1);

  const rating = ratingRows[0] ?? {
    rating: 1500,
    deviation: 350,
    gamesPlayed: 0,
    currentStreak: 0,
    level: 1,
    updatedAt: new Date(),
  };

  const rank = getPvpRankInfo(rating.rating);

  let classified = false;
  if (rating.gamesPlayed > 0) {
    try {
      // Single query replacing two separate COUNT(*) queries: computes total
      // ranked players and players ranked better than us simultaneously.
      const rankingRows = await db.execute(rawSql`
        SELECT
          COUNT(*) FILTER (WHERE games_played > 0)::int AS total_ranked,
          COUNT(*) FILTER (
            WHERE games_played > 0
              AND (
                rating > ${rating.rating}
                OR (rating = ${rating.rating} AND updated_at > ${rating.updatedAt})
              )
          )::int AS better_count
        FROM pvp_ratings
      `);

      const row = rankingRows.rows?.[0] as { total_ranked: number; better_count: number } | undefined;
      const totalRanked = Number(row?.total_ranked ?? 0);
      const betterCount = Number(row?.better_count ?? 0);
      const cutoff = Math.max(1, Math.ceil(totalRanked * 0.01));

      classified = betterCount + 1 <= cutoff;
    } catch {
      classified = false;
    }
  }

  const payload = {
    rating: rating.rating,
    deviation: rating.deviation,
    gamesPlayed: rating.gamesPlayed,
    currentStreak: rating.currentStreak,
    level: rating.level ?? 1,
    updatedAt: rating.updatedAt.toISOString(),
    rank,
    classified,
  };

  await writeCachedPvpSelf(userId, payload);

  return NextResponse.json(payload, { headers: rateLimit.headers });
}
