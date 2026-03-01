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

  const [totalRanked, profiles] = await Promise.all([
    prisma.playerProfile.count({ where: { hideFromLeaderboard: false } }),
    prisma.playerProfile.findMany({
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
    }),
  ]);

  const cutoff = Math.max(1, Math.ceil(totalRanked * 0.01));

  const entries = profiles.map((p, i) => {
    const rank = getRankInfo(p.rating);
    const position = offset + i + 1;
    return {
      position,
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      rating: p.rating,
      tier: rank.tier,
      updatedAt: p.ratingUpdatedAt ? p.ratingUpdatedAt.toISOString() : null,
      classified: position <= cutoff,
    };
  });

  return NextResponse.json({
    limit,
    offset,
    totalRanked,
    cutoff,
    entries,
  });
}
