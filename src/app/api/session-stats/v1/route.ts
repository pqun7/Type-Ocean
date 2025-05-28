//api/session-stats/v1/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import redis, { connectIfNeeded } from '@/lib/redis';
import { enforceRateLimit } from '@/lib/rate-limiter'
import { logging } from "@/log/ServerLogger";

export async function POST(req: NextRequest) {
  await connectIfNeeded();

  const rateLimitHeaders = await enforceRateLimit(
    req,
    '/api/session-stats/v1'
  )
  
  if (rateLimitHeaders instanceof NextResponse && rateLimitHeaders.status === 429) {
    return rateLimitHeaders;
  }

  const userId = req.headers.get("x-user-id");
  if (!userId) {
    logging.warn("[STATS] Unauthorized stats update attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { wpm, accuracy } = await req.json();
  logging.debug(`[STATS] Updating stats for ${userId}`, { wpm, accuracy });

  if (typeof wpm !== "number" || typeof accuracy !== "number") {
    logging.warn(`[STATS] Invalid input for ${userId}`, { wpm, accuracy });
    return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
  }

  const today = new Date().toISOString().split("T")[0];
  const key = `sessionStats:${userId}`;

  try {
    const exists = await redis.exists(key);

    if (!exists) {
      await redis.hSet(key, {
        n: 1,
        avgWpm: wpm,
        avgAcc: accuracy,
        date: today,
      });

      return NextResponse.json({
        dailyAvgWpm: wpm,
        dailyAvgAcc: accuracy,
        sessionsCount: 1,
      });
    }

    const currentData = await redis.hGetAll(key);

    if (currentData?.date !== today) {
      await redis.hSet(key, {
        n: 1,
        avgWpm: wpm,
        avgAcc: accuracy,
        date: today,
      });

      return NextResponse.json({
        dailyAvgWpm: wpm,
        dailyAvgAcc: accuracy,
        sessionsCount: 1,
      });
    }

    const newN = parseInt(String(currentData.n || "0")) + 1;
    const currentWpm = parseFloat(String(currentData.avgWpm || "0"));
    const currentAcc = parseFloat(String(currentData.avgAcc || "0"));

    const newAvgWpm = (currentWpm * (newN - 1) + wpm) / newN;
    const newAvgAcc = (currentAcc * (newN - 1) + accuracy) / newN;

    await redis.hSet(key, {
      n: newN,
      avgWpm: newAvgWpm.toFixed(2),
      avgAcc: newAvgAcc.toFixed(2),
      date: today,
    });

    return NextResponse.json({
      dailyAvgWpm: newAvgWpm,
      dailyAvgAcc: newAvgAcc,
      sessionsCount: newN,
    });

  } catch (error) {
    logging.error(
      `[STATS] Processing error for ${userId}`,
      error,
      { endpoint: "session-stats", userId }
    );

    return NextResponse.json(
      { error: "Failed to process session stats" },
      { status: 500 }
    );
  }
}