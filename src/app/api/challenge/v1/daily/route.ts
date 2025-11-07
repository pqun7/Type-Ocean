// api/challenge/v1/daily/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  generateDailyChallenge,
  calculateChallengeStatus,
} from "@/features/level/utils/challengeHelpers";
import { DailyChallenge, SessionData } from "@/features/level/types/level";
import { v4 as uuidv4 } from "uuid";
import { getUserLevel } from "@/features/level/server-utils/userCache";
import {
  redis,
  connectIfNeeded,
  getCacheKey,
  getCacheTTL,
  authorizeRequest,
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/app/api/challenge/v1/shared";
import { getTodayDate } from "@/app/api/challenge/v1/shared";

// Constants
const CACHE_TTL = getCacheTTL();
const FALLBACK_TTL = 300; // 5 minutes fallback cache
const SERVICE_TYPE = "DAILY-CHALLENGE";
const PARALLEL_OPS = process.env.REDIS_PARALLEL === "true";

const FILE_PATH = "src/app/api/challenge/v1/daily/route.ts";

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

// (authorizeRequest and getCacheKey are imported from shared)

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
      { error: "Failed to fetch daily challenge" },
      { status: 500 }
    );
  }
}

// Replace duplicate POST with unified handler exported below
export const POST = (req: NextRequest) => handleChallengeUpdate(req, "POST");

// Unified challenge update handler
export const handleChallengeUpdate = async (req: NextRequest, method: "POST" | "PUT") => {
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
    const [existing, bodyRaw] = await Promise.all([
      redis.get(cacheKey),
      req.json().catch(() => null),
    ]);

    // Method-specific preprocessing: accept either { progress: {...} } or direct { wpm, accuracy, completed }
    type ChallengeProgress = {
      wpm?: number;
      accuracy?: number;
      completed?: boolean;
      [key: string]: unknown;
    };
    let progress: ChallengeProgress | null = null;
    if (method === "POST") {
      if (bodyRaw && bodyRaw.progress) {
        progress = bodyRaw.progress;
      } else if (bodyRaw && (Number.isFinite(bodyRaw.wpm) || Number.isFinite(bodyRaw.accuracy) || typeof bodyRaw.completed === 'boolean')) {
        progress = { wpm: bodyRaw.wpm, accuracy: bodyRaw.accuracy, completed: !!bodyRaw.completed };
      }
    } else {
      progress = bodyRaw;
    }

    // Validation using Number.isFinite for numeric checks
    if (!progress || !Number.isFinite(progress.wpm) || !Number.isFinite(progress.accuracy)) {
      logRequestError(requestId, SERVICE_TYPE, "Invalid progress data", FILE_PATH, { userId });
      return NextResponse.json({ error: "Invalid input data: wpm and accuracy are required and must be numbers" }, { status: 400 });
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
    
    // Build a merged, fully-populated SessionData object so required numeric fields are never undefined.
    // progress has been runtime-validated earlier, but cast/guard here to satisfy TypeScript.
    const mergedProgress = (() => {
      const existingProgress = (challenge.progress ?? {}) as Partial<SessionData>;
      const input = progress as ChallengeProgress;

      const wpm =
        Number.isFinite(input.wpm as number) ? (input.wpm as number) : existingProgress.wpm ?? 0;
      const accuracy =
        Number.isFinite(input.accuracy as number)
          ? (input.accuracy as number)
          : existingProgress.accuracy ?? 0;

      return {
        ...existingProgress,
        ...input,
        wpm,
        accuracy,
      } as SessionData;
    })();
    
    if (method === "POST") {
      // POST-specific logic (e.g., incremental update)
      updatedChallenge = {
        ...challenge,
        progress: {
          ...mergedProgress,
        },
        status: calculateChallengeStatus(challenge, mergedProgress),
      };
    } else {
      // PUT-specific logic (full replacement)
      updatedChallenge = {
        ...challenge,
        progress: mergedProgress,
        status: calculateChallengeStatus(challenge, mergedProgress),
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
export const PUT = (req: NextRequest) => handleChallengeUpdate(req, "PUT");

// ███ DELETE - Remove challenge ███
export async function DELETE(req: NextRequest) {
  const requestId = uuidv4();
  const userId = authorizeRequest(req);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "DELETE", FILE_PATH, userId!);
    await connectIfNeeded();

  const cacheKey = getCacheKey(userId!);
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
