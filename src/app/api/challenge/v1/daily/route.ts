// api/challenge/v1/daily/route.ts
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
const CACHE_TTL =
  process.env.NODE_ENV === "development" ? 60 : getLocalMidnightTTL();
const FALLBACK_TTL = 300; // 5 minutes fallback cache
const SERVICE_TYPE = "DAILY-CHALLENGE";
const PARALLEL_OPS = process.env.REDIS_PARALLEL === "true";
const FILE_PATH = "src/app/api/challenge/v1/route.ts";

// Helper function for authorization
const validateUserId = (userId: string | null) => {
  return userId && userId !== "undefined" && userId !== "null";
};

// Helper function to generate default challenge when user level is unavailable
const generateDefaultChallenge = async (): Promise<DailyChallenge> => {
  return {
    id: uuidv4(),
    date: getTodayDate(),
    type: "speedCombo",
    target: { wpm: 60, accuracy: 95 },
    xp: 100,
    difficulty: 1,
    status: 0,
    data: {},
  };
};

const getCacheKey = (userId: string) =>
  `dailyChallenge:${userId}:${getTodayDate()}`;

const authorizeRequest = (req: NextRequest) => {
  const userId = req.headers.get("x-user-id");
  const authHeader = req.headers.get("authorization");
  
  if (!userId) return false;
  
  
  // Validate internal requests
  if (typeof window === "undefined" && 
      authHeader !== `Bearer ${process.env.API_INTERNAL_SECRET}`) {
    return false;
  }
  
  return userId;
};

// ███ GET - Fetch daily challenge (optimized) ███
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const userId = authorizeRequest(req);


  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", FILE_PATH, userId!);

    await connectIfNeeded();
    const cacheKey = getCacheKey(userId!);

    // Parallel operations for better performance
    const [cached, userLevel] = await Promise.all([
      redis.get(cacheKey).catch(() => null),
      PARALLEL_OPS ? getUserLevel(userId!).catch(() => null) : null,
    ]);

    if (cached) {
      const parsed = JSON.parse(cached) as DailyChallenge;
      logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
        userId: userId!,
        cacheStatus: "hit",
        challengeId: parsed.id,
      });
      return NextResponse.json(parsed);
    }

    const finalUserLevel = userLevel || (await getUserLevel(userId!));

    if (!cached && !finalUserLevel) {
      // Fallback to default challenge
      const defaultChallenge = await generateDefaultChallenge();
      await redis.setEx(cacheKey, FALLBACK_TTL, JSON.stringify(defaultChallenge));
      return NextResponse.json(defaultChallenge);
    }

    const newChallenge = await generateDailyChallenge(userId!, finalUserLevel);

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(newChallenge));

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
      userId: userId!,
      cacheStatus: "miss",
      challengeId: newChallenge.id,
      ttlSeconds: CACHE_TTL,
    });

    return NextResponse.json(newChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId: userId!,
      operationPhase: "challenge_retrieval",
    });
    return NextResponse.json(
      { error: "Failed to fetch challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}
// Unified challenge update handler
const handleChallengeUpdate = async (req: NextRequest, method: "POST" | "PUT") => {
  const requestId = uuidv4();
  const userId = authorizeRequest(req);
  
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, method, FILE_PATH, userId);
    await connectIfNeeded();

    const today = getTodayDate();
    const cacheKey = getCacheKey(userId);
    const [existing, body] = await Promise.all([
      redis.get(cacheKey),
      req.json(),
    ]);

    // Method-specific preprocessing
    const progress = method === "POST" 
      ? body.progress  // POST expects { progress: ... }
      : body;          // PUT expects direct progress object

    // Validation
    if (!progress || isNaN(progress.wpm) || isNaN(progress.accuracy)) {
      logRequestError(requestId, SERVICE_TYPE, "Invalid progress data", FILE_PATH);
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 });
    }

    if (!existing) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Challenge not found"),
        FILE_PATH,
        { userId, status: 404 }
      );
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    }

    const challenge = JSON.parse(existing) as DailyChallenge;
    if (challenge.date !== today) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Expired challenge"),
        FILE_PATH,
        { userId, challengeDate: challenge.date, currentDate: today }
      );
      return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
    }

    // Method-specific processing
    let updatedChallenge: DailyChallenge;
    if (method === "POST") {
      // POST-specific logic (e.g., incremental update)
      updatedChallenge = {
        ...challenge,
        progress: {
          ...challenge.progress,
          ...progress,  // Merge partial updates
        },
        status: calculateChallengeStatus(challenge, progress),
      };
    } else {
      // PUT-specific logic (full replacement)
      updatedChallenge = {
        ...challenge,
        progress,
        status: calculateChallengeStatus(challenge, progress),
      };
    }

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(updatedChallenge));

    logRequestSuccess(requestId, SERVICE_TYPE, method, FILE_PATH, {
      userId,
      challengeId: updatedChallenge.id,
      newStatus: updatedChallenge.status,
    });

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId,
      operationPhase: `${method.toLowerCase()}_update`,
    });
    return NextResponse.json(
      { error: "Failed to update challenge", referenceId: requestId },
      { status: 500 }
    );
  }
};

// Export wrapped handlers
export const POST = (req: NextRequest) => handleChallengeUpdate(req, "POST");
export const PUT = (req: NextRequest) => handleChallengeUpdate(req, "PUT");

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
      logRequestSuccess(requestId, SERVICE_TYPE, "DELETE", FILE_PATH, {
        userId: userId!,
        message: "No challenge found to delete",
      });
      return NextResponse.json(
        { message: "No challenge found" },
        { status: 200 }
      );
    }

    const deletedCount = await redis.del(cacheKey);

    logRequestSuccess(requestId, SERVICE_TYPE, "DELETE", FILE_PATH, {
      userId: userId!,
      cacheKey,
      deletedCount,
    });

    return NextResponse.json(
      {
        message: deletedCount > 0 ? "Challenge deleted" : "No challenge found",
      },
      { status: 200 }
    );
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId: userId!,
      operationPhase: "challenge_deletion",
    });
    return NextResponse.json(
      { error: "Failed to delete challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}
