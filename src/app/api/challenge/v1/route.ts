// routes.ts - تحسينات الأداء الرئيسية
import { NextRequest, NextResponse } from "next/server";
import {
  generateDailyChallenge,
  calculateChallengeStatus,
} from "@/features/level/utils/challengeHelpers";
import redis, { connectIfNeeded } from "@/lib/redis"; // إضافة دالة pipeline
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

// إعدادات الأداء
const CACHE_TTL =
  process.env.NODE_ENV === "development" ? 60 : getLocalMidnightTTL(); // TTL مختصر للتطوير
const SERVICE_TYPE = "DAILY-CHALLENGE";
const PARALLEL_OPS = process.env.REDIS_PARALLEL === "true"; // تمكين العمليات المتوازية

// ███ GET - جلب التحدي اليومي (مُحسّن) ███
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");
  if (!userId || userId === "undefined" || userId === "null") {
    ("");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logMetadata = (metadata?: object) =>
    createLogMetadata(requestId, SERVICE_TYPE, metadata);

  // const rateLimitHeaders = await enforceRateLimit(req, '/api/session-stats/v1')
  // if (rateLimitHeaders instanceof NextResponse) return rateLimitHeaders;

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", userId);

    try {
      await connectIfNeeded();
    } catch (error) {
      logRequestError(requestId, SERVICE_TYPE, error, {
        operationPhase: "redis_connection",
      });
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 } 
      );
    }

    if (!userId) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Unauthorized access"),
        {
          status: 401,
          securityEvent: true,
          operationPhase: "authentication",
        }
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = getTodayDate();
    const cacheKey = `dailyChallenge:${userId}:${today}`;

    // التحقق من الكاش مع pipeline لتحسين الأداء
    const [cached, userLevel] = await Promise.all([
      redis.get(cacheKey).catch(() => null), // إضافة معالجة الأخطاء
      PARALLEL_OPS ? getUserLevel(userId).catch(() => null) : null,
    ]);

    if (cached) {
      const parsed = JSON.parse(cached) as DailyChallenge;
      logRequestSuccess(requestId, SERVICE_TYPE, "GET", {
        cacheStatus: "hit",
        challengeId: parsed.id,
      });
      return NextResponse.json(parsed);
    }

    // إنشاء التحدي مع pipeline
    const finalUserLevel = userLevel || (await getUserLevel(userId));
    const newChallenge = await generateDailyChallenge(userId, finalUserLevel);

    // استخدام pipeline لعمليات Redis
    const redisMulti = redis.multi();
    redisMulti.setEx(cacheKey, CACHE_TTL, JSON.stringify(newChallenge));
    await redisMulti.exec();

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", {
      cacheStatus: "miss",
      challengeId: newChallenge.id,
      ttlSeconds: CACHE_TTL,
    });

    return NextResponse.json(newChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, {
      operationPhase: "challenge_retrieval",
      userId,
    });
    return NextResponse.json(
      { error: "Failed to fetch challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// ███ POST - تحديث التقدم (مُحسّن) ███
export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");

  // تحسين التحقق من الهوية ليتضمن القيم الفارغة
  if (!userId || userId === "undefined" || userId === "null") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logMetadata = (metadata?: object) =>
    createLogMetadata(requestId, SERVICE_TYPE, metadata);

  try {
    logRequestStart(requestId, SERVICE_TYPE, "POST", userId);

    try {
      await connectIfNeeded();
    } catch (error) {
      throw new Error("Redis connection failed");
    }

    if (!userId) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Unauthorized access"),
        {
          status: 401,
          securityEvent: true,
          operationPhase: "authentication",
        }
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = getTodayDate();

    const cacheKey = `dailyChallenge:${userId}:${today}`;

    // قراءة وتحديث البيانات في عملية واحدة
    const [existing, progress] = await Promise.all([
      redis.get(cacheKey),
      req.json().then((data) => data.progress),
    ]);

    if (typeof progress !== "object" || progress === null) {
      return NextResponse.json(
        { error: "Invalid progress format" },
        { status: 400 }
      );
    }

    if (!existing) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Challenge not found"),
        {
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
      logRequestError(requestId, SERVICE_TYPE, new Error("Expired challenge"), {
        challengeDate: challenge.date,
        currentDate: today,
        status: 410,
        operationPhase: "date_validation",
      });
      return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
    }

    const updatedChallenge = {
      ...challenge,
      progress,
      status: calculateChallengeStatus(challenge, progress),
    };

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(updatedChallenge));

    logRequestSuccess(requestId, SERVICE_TYPE, "POST", {
      challengeId: updatedChallenge.id,
      newStatus: updatedChallenge.status,
    });

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, {
      operationPhase: "progress_update",
      userId,
    });
    return NextResponse.json(
      { error: "Failed to update challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// ███ DELETE - حذف التحدي (مُحسّن) ███
export async function DELETE(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get("x-user-id");
  // تحسين التحقق من الهوية ليتضمن القيم الفارغة
  if (!userId || userId === "undefined" || userId === "null") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const logMetadata = (metadata?: object) =>
    createLogMetadata(requestId, SERVICE_TYPE, metadata);

  try {
    logRequestStart(requestId, SERVICE_TYPE, "DELETE", userId);

    try {
      await connectIfNeeded();
    } catch (error) {
      throw new Error("Redis connection failed");
    }

    if (!userId) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Unauthorized access"),
        {
          status: 401,
          securityEvent: true,
          operationPhase: "authentication",
        }
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cacheKey = `dailyChallenge:${userId}:${getTodayDate()}`;
    const exists = await redis.exists(cacheKey);
    if (!exists) {
      return NextResponse.json(
        { message: "No challenge found" },
        { status: 200 }
      );
    }
    const deletedCount = await redis.del(cacheKey);

    logRequestSuccess(requestId, SERVICE_TYPE, "DELETE", {
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
    logRequestError(requestId, SERVICE_TYPE, error, {
      operationPhase: "challenge_deletion",
      userId,
    });
    return NextResponse.json(
      { error: "Failed to delete challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}
