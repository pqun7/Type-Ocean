export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
import { authorizeRequest } from "@/app/api/shared.server";
import { getPvpRankInfo } from "@/features/pvp/rank";

export async function GET(req: NextRequest) {
  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rating = await prisma.pvpRating.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { rating: true, deviation: true, gamesPlayed: true, updatedAt: true },
  });

  const rank = getPvpRankInfo(rating.rating);

  return NextResponse.json({
    rating: rating.rating,
    deviation: rating.deviation,
    gamesPlayed: rating.gamesPlayed,
    updatedAt: rating.updatedAt.toISOString(),
    rank,
  });
}
