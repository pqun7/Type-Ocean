// api/challenge/v1/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  generateDailyChallenge,
  calculateChallengeStatus,
} from "@/features/level/utils/challengeHelpers";
import redis, { connectIfNeeded } from "@/lib/redis";
import {
  getLocalMidnightTTL,
  getTodayDate,
} from "@/features/auth/utils/timeUtils";
import { DailyChallenge } from "@/features/level/types/level";
import { v4 as uuidv4 } from "uuid";
import { getUserLevel } from "@/features/level/server-utils/userCache";
import {
  createLogMetadata,
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";

// Constants
const CACHE_TTL = process.env.NODE_ENV === "development" ? 60 : getLocalMidnightTTL();
const SERVICE_TYPE = "DAILY-CHALLENGE";
const PARALLEL_OPS = process.env.REDIS_PARALLEL === "true";
const FILE_PATH = "src/app/api/challenge/v1/route.ts";

// Helper function for authorization
const validateUserId = (userId: string | null) => {
  return userId && userId !== "undefined" && userId !== "null";
};

// ███ GET - Fetch daily challenge (optimized) ███
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");

  if (!validateUserId(userId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", FILE_PATH, userId!);

    await connectIfNeeded();
    const today = getTodayDate();
    const cacheKey = `dailyChallenge:${userId}:${today}`;

    // Parallel operations for better performance
    const [cached, userLevel] = await Promise.all([
      redis.get(cacheKey).catch(() => null),
      PARALLEL_OPS ? getUserLevel(userId!).catch(() => null) : null,
    ]);

    if (cached) {
      const parsed = JSON.parse(cached) as DailyChallenge;
      logRequestSuccess(
        requestId,
        SERVICE_TYPE,
        "GET",
        FILE_PATH,
        { userId: userId!, cacheStatus: "hit", challengeId: parsed.id }
      );
      return NextResponse.json(parsed);
    }

    const finalUserLevel = userLevel || (await getUserLevel(userId!));
    const newChallenge = await generateDailyChallenge(userId!, finalUserLevel);

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(newChallenge));

    logRequestSuccess(
      requestId,
      SERVICE_TYPE,
      "GET",
      FILE_PATH,
      {
        userId: userId!,
        cacheStatus: "miss",
        challengeId: newChallenge.id,
        ttlSeconds: CACHE_TTL,
      }
    );

    return NextResponse.json(newChallenge);
  } catch (error) {
    logRequestError(
      requestId,
      SERVICE_TYPE,
      error,
      FILE_PATH,
      {
        userId: userId!,
        operationPhase: "challenge_retrieval",
      }
    );
    return NextResponse.json(
      { error: "Failed to fetch challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// ███ POST - Update challenge progress (optimized) ███
export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");

  if (!validateUserId(userId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "POST", FILE_PATH, userId!);
    await connectIfNeeded();

    const today = getTodayDate();
    const cacheKey = `dailyChallenge:${userId}:${today}`;
    
    const [existing, { progress }] = await Promise.all([
      redis.get(cacheKey),
      req.json(),
    ]);

    if (!existing) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Challenge not found"),
        FILE_PATH,
        {
          userId: userId!,
          status: 404,
          operationPhase: "challenge_validation",
        }
      );
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 404 }
      );
    }

    const challenge = JSON.parse(existing) as DailyChallenge;
    if (challenge.date !== today) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Expired challenge"),
        FILE_PATH,
        {
          userId: userId!,
          challengeDate: challenge.date,
          currentDate: today,
          status: 410,
          operationPhase: "date_validation",
        }
      );
      return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
    }

    const updatedChallenge = {
      ...challenge,
      progress,
      status: calculateChallengeStatus(challenge, progress),
    };

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(updatedChallenge));

    logRequestSuccess(
      requestId,
      SERVICE_TYPE,
      "POST",
      FILE_PATH,
      {
        userId: userId!,
        challengeId: updatedChallenge.id,
        newStatus: updatedChallenge.status,
      }
    );

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logRequestError(
      requestId,
      SERVICE_TYPE,
      error,
      FILE_PATH,
      {
        userId: userId!,
        operationPhase: "progress_update",
      }
    );
    return NextResponse.json(
      { error: "Failed to update challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// ███ PUT - Alternative update endpoint ███
export async function PUT(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");

  if (!validateUserId(userId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "PUT", FILE_PATH, userId!);
    await connectIfNeeded();

    const today = getTodayDate();
    const cacheKey = `dailyChallenge:${userId}:${today}`;
    const existing = await redis.get(cacheKey);

    if (!existing) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Challenge not found"),
        FILE_PATH,
        {
          userId: userId!,
          status: 404,
          operationPhase: "challenge_validation",
        }
      );
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 404 }
      );
    }

    const { progress } = await req.json();
    const challenge = JSON.parse(existing) as DailyChallenge;

    if (challenge.date !== today) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Expired challenge"),
        FILE_PATH,
        {
          userId: userId!,
          challengeDate: challenge.date,
          currentDate: today,
          status: 410,
          operationPhase: "date_validation",
        }
      );
      return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
    }

    const updatedChallenge = {
      ...challenge,
      progress,
      status: calculateChallengeStatus(challenge, progress),
    };

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(updatedChallenge));

    logRequestSuccess(
      requestId,
      SERVICE_TYPE,
      "PUT",
      FILE_PATH,
      {
        userId: userId!,
        challengeId: updatedChallenge.id,
        newStatus: updatedChallenge.status,
      }
    );

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logRequestError(
      requestId,
      SERVICE_TYPE,
      error,
      FILE_PATH,
      {
        userId: userId!,
        operationPhase: "challenge_update",
      }
    );
    return NextResponse.json(
      { error: "Failed to update challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// ███ DELETE - Remove challenge ███
export async function DELETE(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");

  if (!validateUserId(userId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "DELETE", FILE_PATH, userId!);
    await connectIfNeeded();

    const cacheKey = `dailyChallenge:${userId}:${getTodayDate()}`;
    const exists = await redis.exists(cacheKey);

    if (!exists) {
      logRequestSuccess(
        requestId,
        SERVICE_TYPE,
        "DELETE",
        FILE_PATH,
        {
          userId: userId!,
          message: "No challenge found to delete",
        }
      );
      return NextResponse.json(
        { message: "No challenge found" },
        { status: 200 }
      );
    }

    const deletedCount = await redis.del(cacheKey);

    logRequestSuccess(
      requestId,
      SERVICE_TYPE,
      "DELETE",
      FILE_PATH,
      {
        userId: userId!,
        cacheKey,
        deletedCount,
      }
    );

    return NextResponse.json(
      {
        message: deletedCount > 0 ? "Challenge deleted" : "No challenge found",
      },
      { status: 200 }
    );
  } catch (error) {
    logRequestError(
      requestId,
      SERVICE_TYPE,
      error,
      FILE_PATH,
      {
        userId: userId!,
        operationPhase: "challenge_deletion",
      }
    );
    return NextResponse.json(
      { error: "Failed to delete challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}