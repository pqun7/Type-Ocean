//api/session-stats/v1/route.ts
export const runtime = "nodejs";
import { v4 as uuidv4 } from "uuid";

import { NextRequest, NextResponse } from "next/server";
import redis, { connectIfNeeded } from "@/lib/redis";
import { enforceRateLimit } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";

import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";

const SERVICE_TYPE = "SESSION-STATS";
const LOG_FILE = "src/app/api/session-stats/v1/route.ts";

export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const endpoint = "/api/session-stats/v1";

  // Ensure Redis connection before proceeding
  try {
    await connectIfNeeded();
  } catch (error) {
    logging.error("[STATS] Redis connection failed", error, {
      requestId,
      endpoint,
    });
    return NextResponse.json(
      { error: "Database connection failed. Please try again." },
      { status: 503 }
    );
  }

  logRequestStart(
    requestId,
    SERVICE_TYPE,
    "POST",
    LOG_FILE,
    req.headers.get("x-user-id") || undefined
  );

  // Rate limiting
  const rateLimitHeaders = await enforceRateLimit(req, "/api/session-stats/v1");
  if (rateLimitHeaders instanceof NextResponse && rateLimitHeaders.status === 429) {
    return rateLimitHeaders;
  }

  // User authentication
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    logging.warn("[STATS] Unauthorized stats update attempt", {
      ip: req.headers.get("x-forwarded-for") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Content type validation
  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return NextResponse.json(
      { error: "Invalid content type. Expected application/json" },
      { status: 415 }
    );
  }

  // JSON parsing with error handling
  let body;
  try {
    body = await req.json();
  } catch (error) {
    logging.warn("[STATS] JSON parsing error", {
      error: error instanceof Error ? error.message : "Unknown error",
      requestId,
      userId,
    });
    return NextResponse.json(
      { error: "Invalid JSON format in request body" },
      { status: 400 }
    );
  }

  // Data validation
  const { wpm, accuracy } = body;
  logging.debug(`[STATS] Updating stats for ${userId}`, { wpm, accuracy, requestId });

  if (wpm == null || accuracy == null || typeof wpm !== "number" || typeof accuracy !== "number") {
    logging.warn(`[STATS] Invalid input for ${userId}`, { 
      wpm, 
      accuracy, 
      requestId,
      types: { wpm: typeof wpm, accuracy: typeof accuracy }
    });
    return NextResponse.json(
      { error: "Invalid data format. wpm and accuracy must be numbers" },
      { status: 400 }
    );
  }

  // Additional validation for reasonable values
  if (wpm < 0 || wpm > 500) {
    logging.warn(`[STATS] Unrealistic WPM value for ${userId}`, { wpm, requestId });
    return NextResponse.json(
      { error: "Invalid WPM value. Must be between 0 and 500" },
      { status: 400 }
    );
  }

  if (accuracy < 0 || accuracy > 100) {
    logging.warn(`[STATS] Invalid accuracy value for ${userId}`, { accuracy, requestId });
    return NextResponse.json(
      { error: "Invalid accuracy value. Must be between 0 and 100" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const key = `sessionStats:${userId}`;

  try {
    const exists = await redis.exists(key);

    // Handle new user or reset daily stats
    if (!exists || (exists && (await redis.hGet(key, "date")) !== today)) {
      await redis.hSet(key, {
        n: 1,
        avgWpm: wpm,
        avgAcc: accuracy,
        date: today,
      });

      logging.info(`[STATS] New daily stats created for ${userId}`, {
        wpm,
        accuracy,
        date: today,
        requestId,
      });

      logRequestSuccess(
        requestId,
        SERVICE_TYPE,
        "POST",
        LOG_FILE,
        { userId, endpoint }
      );

      return NextResponse.json({
        dailyAvgWpm: wpm,
        dailyAvgAcc: accuracy,
        sessionsCount: 1,
      });
    }

    const currentData = await redis.hGetAll(key);

    // Validate Redis data
    if (!currentData || Object.keys(currentData).length === 0) {
      logging.warn(`[STATS] Empty Redis data for ${userId}, creating new entry`, { requestId });
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

    // Validate parsed values
    if (isNaN(newN) || isNaN(currentWpm) || isNaN(currentAcc)) {
      logging.error(`[STATS] Invalid Redis data for ${userId}`, {
        currentData,
        parsed: { newN, currentWpm, currentAcc },
        requestId,
      });

      // Reset to new entry if data is corrupted
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

    const newAvgWpm = (currentWpm * (newN - 1) + wpm) / newN;
    const newAvgAcc = (currentAcc * (newN - 1) + accuracy) / newN;

    await redis.hSet(key, {
      n: newN,
      avgWpm: newAvgWpm.toFixed(2),
      avgAcc: newAvgAcc.toFixed(2),
      date: today,
    });

    logging.info(`[STATS] Daily stats updated for ${userId}`, {
      n: newN,
      avgWpm: newAvgWpm.toFixed(2),
      avgAcc: newAvgAcc.toFixed(2),
      date: today,
      requestId,
    });

    logRequestSuccess(
      requestId,
      SERVICE_TYPE,
      "POST",
      LOG_FILE,
      { userId, endpoint }
    );

    return NextResponse.json({
      dailyAvgWpm: newAvgWpm,
      dailyAvgAcc: newAvgAcc,
      sessionsCount: newN,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logging.error(`[STATS] Processing error for ${userId}`, error, {
      requestId,
      userId,
      wpm,
      accuracy,
      redisKey: key,
      errorMessage,
    });

    logRequestError(
      requestId,
      SERVICE_TYPE,
      error,
      LOG_FILE,
      {
        endpoint: "session-stats",
        userId,
      }
    );

    // Check if it's a Redis-specific error
    if (errorMessage.includes("Redis") || errorMessage.includes("Connection")) {
      return NextResponse.json(
        { error: "Database connection error. Please try again." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Failed to process session stats" },
      { status: 500 }
    );
  }
}
