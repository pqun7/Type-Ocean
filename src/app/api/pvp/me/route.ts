export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
import { authorizeRequest } from "@/app/api/shared.server";
import { getPvpRankInfo } from "@/features/pvp/rank";
import { rateLimiter } from "@/lib/rate-limiter";

export async function GET(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/me:GET");
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  const rating = await prisma.pvpRating.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { rating: true, deviation: true, gamesPlayed: true, updatedAt: true },
  });

  const rank = getPvpRankInfo(rating.rating);

  let classified = false;
  if (rating.gamesPlayed > 0) {
    try {
      const totalRanked = await prisma.pvpRating.count({
        where: { gamesPlayed: { gt: 0 } },
      });

      const cutoff = Math.max(1, Math.ceil(totalRanked * 0.01));

      const betterCount = await prisma.pvpRating.count({
        where: {
          gamesPlayed: { gt: 0 },
          OR: [
            { rating: { gt: rating.rating } },
            {
              AND: [
                { rating: { equals: rating.rating } },
                { updatedAt: { gt: rating.updatedAt } },
              ],
            },
          ],
        },
      });

      classified = betterCount + 1 <= cutoff;
    } catch {
      classified = false;
    }
  }

  return NextResponse.json(
    {
      rating: rating.rating,
      deviation: rating.deviation,
      gamesPlayed: rating.gamesPlayed,
      updatedAt: rating.updatedAt.toISOString(),
      rank,
      classified,
    },
    { headers: rateLimit.headers }
  );
}
