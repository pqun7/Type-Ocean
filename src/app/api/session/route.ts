// api/session-stats/v1/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import redis, { connectIfNeeded } from "@/lib/redis";
import { enforceRateLimit } from "@/features/auth/lib/rate-limiter";
import { v4 as uuidv4 } from "uuid";
import {
  createLogMetadata,
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";
import { logging } from "@/log/ServerLogger";

export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const logType = "SESSION-STATS";

  try {
    await connectIfNeeded();
    logRequestStart(requestId, logType, "POST", req.headers.get("x-user-id"));

    // const rateLimitHeaders = await enforceRateLimit(req, '/api/session-stats/v1')
    // if (rateLimitHeaders instanceof NextResponse) return rateLimitHeaders;

    const userId = req.headers.get("x-user-id");
    if (!userId) {
      logging.warn(
        "Unauthorized access attempt",
        createLogMetadata(requestId, logType, {
          status: 401,
          securityEvent: true,
        })
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { wpm, accuracy } = await req.json();
    logging.debug(
      "Processing stats update",
      createLogMetadata(requestId, logType, {
        wpm,
        accuracy,
        operation: "data_validation",
      })
    );

    if (typeof wpm !== "number" || typeof accuracy !== "number") {
      logging.warn(
        "Invalid input data",
        createLogMetadata(requestId, logType, {
          status: 400,
          receivedTypes: {
            wpm: typeof wpm,
            accuracy: typeof accuracy,
          },
        })
      );
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const key = `sessionStats:${userId}`;

    try {
      const exists = await redis.exists(key);
      logging.debug(
        "Redis key check",
        createLogMetadata(requestId, logType, {
          key,
          keyExists: exists,
        })
      );

      if (!exists) {
        await redis.hSet(key, {
          n: 1,
          avgWpm: wpm,
          avgAcc: accuracy,
          date: today,
        });
        logRequestSuccess(requestId, logType, "POST", {
          status: 201,
          dailyAvgWpm: wpm,
          dailyAvgAcc: accuracy,
        });
        return NextResponse.json({
          dailyAvgWpm: wpm,
          dailyAvgAcc: accuracy,
          sessionsCount: 1,
        });
      }

      const currentData = await redis.hGetAll(key);
      logging.debug(
        "Current Redis data",
        createLogMetadata(requestId, logType, currentData)
      );

      if (currentData?.date !== today) {
        logging.debug(
          "Resetting daily stats",
          createLogMetadata(requestId, logType, {
            previousDate: currentData.date,
            newDate: today,
          })
        );
        await redis.hSet(key, {
          n: 1,
          avgWpm: wpm,
          avgAcc: accuracy,
          date: today,
        });
        logRequestSuccess(requestId, logType, "POST", {
          status: 200,
          dailyAvgWpm: wpm,
          dailyAvgAcc: accuracy,
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

      logRequestSuccess(requestId, logType, "POST", {
        status: 200,
        sessionsCount: newN,
        calculatedValues: {
          newAvgWpm,
          newAvgAcc,
        },
      });

      return NextResponse.json({
        dailyAvgWpm: newAvgWpm,
        dailyAvgAcc: newAvgAcc,
        sessionsCount: newN,
      });
    } catch (error) {
      logRequestError(requestId, logType, error, {
        operationPhase: "redis_operation",
        userId,
        key,
      });
      return NextResponse.json(
        { error: "Failed to process session stats" },
        { status: 500 }
      );
    }
  } catch (error) {
    logRequestError(requestId, logType, error, {
      operationPhase: "request_processing",
      userId: req.headers.get("x-user-id"),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
