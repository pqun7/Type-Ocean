export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getLeaderboardPage } from "@/features/pvp/server/leaderboard-cache";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limitRaw = Number(searchParams?.get("limit") ?? "50");
  const offsetRaw = Number(searchParams?.get("offset") ?? "0");

  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

  return NextResponse.json(await getLeaderboardPage({ limit, offset }));
}
