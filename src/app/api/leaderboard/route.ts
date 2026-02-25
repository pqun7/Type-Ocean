export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
import { getRankInfo } from "@/features/ranking/rating";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const offsetRaw = Number(searchParams.get("offset") ?? "0");

  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

  const profiles = await prisma.playerProfile.findMany({
    where: { hideFromLeaderboard: false },
    orderBy: [{ rating: "desc" }, { updatedAt: "desc" }],
    take: limit,
    skip: offset,
    select: {
      userId: true,
      username: true,
      avatar: true,
      rating: true,
      ratingUpdatedAt: true,
    },
  });

  const entries = profiles.map((p, i) => {
    const rank = getRankInfo(p.rating);
    return {
      position: offset + i + 1,
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      rating: p.rating,
      tier: rank.tier,
      division: rank.division,
      updatedAt: p.ratingUpdatedAt ? p.ratingUpdatedAt.toISOString() : null,
    };
  });

  return NextResponse.json({
    limit,
    offset,
    entries,
  });
}
