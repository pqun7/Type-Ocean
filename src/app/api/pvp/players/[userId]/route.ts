export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { playerProfiles, pvpRatings } from "@/db/schema";
import { rateLimiter } from "@/lib/rate-limiter";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUserId(rawUserId: string): string {
  try {
    return decodeURIComponent(rawUserId);
  } catch {
    return rawUserId;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/players:GET");
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const { userId: rawUserId } = await params;
  const userId = normalizeUserId(rawUserId);

  if (userId.startsWith("ai:")) {
    return NextResponse.json({ level: 1, currentStreak: 0 }, { headers: rateLimit.headers });
  }

  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400, headers: rateLimit.headers });
  }

  const rows = await db
    .select({
      level: playerProfiles.level,
      currentStreak: pvpRatings.currentStreak,
    })
    .from(playerProfiles)
    .leftJoin(pvpRatings, eq(pvpRatings.userId, playerProfiles.userId))
    .where(eq(playerProfiles.userId, userId))
    .limit(1);

  const level = rows[0]?.level ?? 1;
  const currentStreak = rows[0]?.currentStreak ?? 0;

  return NextResponse.json({ level, currentStreak }, { headers: rateLimit.headers });
}
