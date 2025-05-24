// routes.ts
import { NextRequest, NextResponse } from "next/server";
import { generateDailyChallenge, calculateChallengeStatus } from "@/features/level/utils/challengeHelpers";
import redis, { connectIfNeeded } from "@/lib/redis";
import { getLocalMidnightTTL, getTodayDate } from "@/features/auth/utils/timeUtils";
import { DailyChallenge } from "@/features/level/types/level";
import { v4 as uuidv4 } from "uuid";
import { getUserLevel } from "@/features/level/server-utils/userCache";
import {
  createLogMetadata,
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";
import { logging } from "@/log/ServerLogger";


// إعدادات ثابتة
const SERVICE_TYPE = "DAILY-CHALLENGE";

// ███ GET - جلب التحدي اليومي ███
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");
  const logMetadata = (metadata?: object) => createLogMetadata(requestId, SERVICE_TYPE, metadata);

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", userId);
    await connectIfNeeded();

    if (!userId) {
      logRequestError(requestId, SERVICE_TYPE, new Error("Unauthorized access"), {
        status: 401,
        securityEvent: true,
        operationPhase: "authentication"
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = getTodayDate();
    const cacheKey = `dailyChallenge:${userId}:${today}`;

    // عملية التحقق من الكاش
    logging.debug("Initiating cache check", logMetadata({
      operation: "cache_retrieval",
      cacheKey
    }));

    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as DailyChallenge;
      logRequestSuccess(requestId, SERVICE_TYPE, "GET", {
        cacheStatus: "hit",
        challengeId: parsed.id,
        ttl: await redis.ttl(cacheKey)
      });
      return NextResponse.json(parsed);
    }

    // عملية إنشاء التحدي
    logging.debug("Generating new challenge", logMetadata({
      operation: "challenge_generation",
      userLevel: await getUserLevel(userId)
    }));

    const newChallenge = await generateDailyChallenge(userId, await getUserLevel(userId));
    const ttl = getLocalMidnightTTL();

    await redis.setEx(cacheKey, ttl, JSON.stringify(newChallenge));
    
    logRequestSuccess(requestId, SERVICE_TYPE, "GET", {
      cacheStatus: "miss",
      challengeId: newChallenge.id,
      difficulty: newChallenge.difficulty,
      ttlSeconds: ttl,
      generatedAt: new Date().toISOString()
    });

    return NextResponse.json(newChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, {
      operationPhase: "challenge_retrieval",
      userId,
      cacheKey: `dailyChallenge:${userId}:${getTodayDate()}`
    });
    return NextResponse.json(
      { error: "Failed to fetch challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// ███ POST - تحديث تقدم التحدي ███
export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");
  const logMetadata = (metadata?: object) => createLogMetadata(requestId, SERVICE_TYPE, metadata);

  try {
    logRequestStart(requestId, SERVICE_TYPE, "POST", userId);
    await connectIfNeeded();

    if (!userId) {
      logRequestError(requestId, SERVICE_TYPE, new Error("Unauthorized access"), {
        status: 401,
        securityEvent: true,
        operationPhase: "authentication"
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = getTodayDate();
    const cacheKey = `dailyChallenge:${userId}:${today}`;

    // التحقق من وجود التحدي
    logging.debug("Validating challenge existence", logMetadata({ cacheKey }));
    const existing = await redis.get(cacheKey);
    
    if (!existing) {
      logRequestError(requestId, SERVICE_TYPE, new Error("Challenge not found"), {
        status: 404,
        operationPhase: "challenge_validation"
      });
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    }

    // التحقق من تاريخ التحدي
    const challenge = JSON.parse(existing) as DailyChallenge;
    if (challenge.date !== today) {
      logRequestError(requestId, SERVICE_TYPE, new Error("Expired challenge"), {
        challengeDate: challenge.date,
        currentDate: today,
        status: 400,
        operationPhase: "date_validation"
      });
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
    }

    // معالجة البيانات الواردة
    const { progress } = await req.json();
    if (!progress || typeof progress !== "object") {
      logRequestError(requestId, SERVICE_TYPE, new Error("Invalid progress data"), {
        receivedType: typeof progress,
        status: 400,
        operationPhase: "data_validation"
      });
      return NextResponse.json({ error: "Invalid progress data" }, { status: 400 });
    }

    // تحديث حالة التحدي
    const updatedChallenge = {
      ...challenge,
      progress,
      status: calculateChallengeStatus(challenge, progress),
      lastUpdated: new Date().toISOString()
    };

    await redis.setEx(cacheKey, getLocalMidnightTTL(), JSON.stringify(updatedChallenge));
    
    const updatedFields = (Object.keys(updatedChallenge) as Array<keyof DailyChallenge>).filter(
      k => k !== 'id' && challenge[k] !== updatedChallenge[k]
    );

    logRequestSuccess(requestId, SERVICE_TYPE, "POST", {
      challengeId: updatedChallenge.id,
      newStatus: updatedChallenge.status,
      progressKeys: Object.keys(progress),
      updatedFields
    });

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, {
      operationPhase: "progress_update",
      userId,
      cacheKey: `dailyChallenge:${userId}:${getTodayDate()}`
    });
    return NextResponse.json(
      { error: "Failed to update challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// ███ DELETE - حذف التحدي ███
export async function DELETE(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");
  const logMetadata = (metadata?: object) => createLogMetadata(requestId, SERVICE_TYPE, metadata);

  try {
    logRequestStart(requestId, SERVICE_TYPE, "DELETE", userId);
    await connectIfNeeded();

    if (!userId) {
      logRequestError(requestId, SERVICE_TYPE, new Error("Unauthorized access"), {
        status: 401,
        securityEvent: true,
        operationPhase: "authentication"
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = getTodayDate();
    const cacheKey = `dailyChallenge:${userId}:${today}`;

    logging.debug("Initiating challenge deletion", logMetadata({ cacheKey }));
    const deletedCount = await redis.del(cacheKey);

    if (deletedCount === 0) {
      logging.info("No challenge found for deletion", logMetadata({
        cacheKey,
        operationPhase: "challenge_deletion"
      }));
      return NextResponse.json({ message: "No challenge found" });
    }

    logRequestSuccess(requestId, SERVICE_TYPE, "DELETE", {
      cacheKey,
      deletedCount,
      deletionTime: new Date().toISOString()
    });

    return NextResponse.json({ message: "Challenge deleted successfully" });
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, {
      operationPhase: "challenge_deletion",
      userId,
      cacheKey: `dailyChallenge:${userId}:${getTodayDate()}`
    });
    return NextResponse.json(
      { error: "Failed to delete challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}