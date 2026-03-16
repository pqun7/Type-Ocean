export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, gt, or } from "drizzle-orm";

import { db } from "@/db";
import { pvpRatings } from "@/db/schema";
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
      updatedAt: pvpRatings.updatedAt,
    })
    .from(pvpRatings)
    .where(eq(pvpRatings.userId, userId))
    .limit(1);

  const rating = ratingRows[0] ?? {
    rating: 1500,
    deviation: 350,
    gamesPlayed: 0,
    updatedAt: new Date(),
  };

  const rank = getPvpRankInfo(rating.rating);

  let classified = false;
  if (rating.gamesPlayed > 0) {
    try {
      const totalRankedRows = await db
        .select({ value: count() })
        .from(pvpRatings)
        .where(gt(pvpRatings.gamesPlayed, 0));

      const totalRanked = Number(totalRankedRows[0]?.value ?? 0);

      const cutoff = Math.max(1, Math.ceil(totalRanked * 0.01));

      const betterCountRows = await db
        .select({ value: count() })
        .from(pvpRatings)
        .where(
          and(
            gt(pvpRatings.gamesPlayed, 0),
            or(
              gt(pvpRatings.rating, rating.rating),
              and(eq(pvpRatings.rating, rating.rating), gt(pvpRatings.updatedAt, rating.updatedAt)),
            ),
          ),
        );

      const betterCount = Number(betterCountRows[0]?.value ?? 0);

      classified = betterCount + 1 <= cutoff;
    } catch {
      classified = false;
    }
  }

  const payload = {
    rating: rating.rating,
    deviation: rating.deviation,
    gamesPlayed: rating.gamesPlayed,
    updatedAt: rating.updatedAt.toISOString(),
    rank,
    classified,
  };

  await writeCachedPvpSelf(userId, payload);

  return NextResponse.json(payload, { headers: rateLimit.headers });
}
