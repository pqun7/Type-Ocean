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
  getCacheKeyForDate,
  getChallengeIdKey,
  getCacheTTL,
  authorizeRequest,
  getTodayDate,
} from "@/app/api/shared.server"; // Changed import
import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";
import { getToken } from 'next-auth/jwt';
import { atomicChallengeUpdate } from "@/features/level/utils/challengeServer"; // Changed import
import { getLongTermCumulativeStats } from "@/helper/session-stats";
import { getLastChallengeOutcome } from "@/features/level/server-utils/dailyChallengeOutcome";
import { getDailyChallengeStreak } from "@/features/level/server-utils/dailyChallengeStreak";
import { recordChallengeOutcomeIfCompleted } from "@/features/level/server-utils/dailyChallengeOutcome";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizeSessionForChallenge(session: SessionData): SessionData {
  // Hard sanity bounds to prevent unrealistic / cheating updates.
  // These should remain generous enough not to reject legitimate sessions.
  return {
    ...session,
    wpm: clamp(Number(session.wpm) || 0, 0, 300),
    accuracy: clamp(Number(session.accuracy) || 0, 0, 100),
    textLength: Math.max(0, Math.min(20000, Math.floor(Number(session.textLength) || 0))),
    timeSpent: Math.max(0, Math.min(7200, Math.floor(Number(session.timeSpent) || 0))),
    errors: Math.max(0, Math.min(5000, Math.floor(Number(session.errors) || 0))),
    dailyAvgWpm: Math.max(0, Math.min(300, Number(session.dailyAvgWpm) || 0)),
    dailyAvgAcc: clamp(Number(session.dailyAvgAcc) || 0, 0, 100),
    sessionsCount: Math.max(0, Math.min(1000, Math.floor(Number(session.sessionsCount) || 0))),
    textType: session.textType,
  };
}

export async function authenticateRequest(req: NextRequest) {
  try {
    const token = await getToken({ 
      req,
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
    });
    
    const userId = (token?.id as string | undefined) ?? token?.sub;
    if (!userId) {
      return { error: 'Unauthorized', status: 401 };
    }
    
    return { userId };
  } catch {
    return { error: 'Authentication failed', status: 500 };
  }
}

// Constants
const CACHE_TTL = getCacheTTL();
const FALLBACK_TTL = 300; // 5 minutes fallback cache
const SERVICE_TYPE = "DAILY-CHALLENGE";
const PARALLEL_OPS = process.env.REDIS_PARALLEL === "true";

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

// ███ GET - Fetch daily challenge (optimized) ███
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const authResult = await authenticateRequest(req);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const userId = authResult.userId;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", userId!);

    await connectIfNeeded();
    const cacheKey = getCacheKey(userId!);

    // Parallel operations for better performance
    const [cached, userLevel] = await Promise.all([
      redis.get(cacheKey).catch(() => null),
      PARALLEL_OPS ? getUserLevel(userId!).catch(() => null) : null,
    ]);

    if (cached) {
      const parsed = JSON.parse(cached) as DailyChallenge;

      // Ensure an ID-indexed key exists so updates by challengeId keep working.
      // Preserve the remaining TTL of the date-key to avoid extending beyond midnight.
      try {
        const ttlSeconds = await redis.ttl(cacheKey).catch(() => -1);
        const ttlToUse = ttlSeconds > 0 ? ttlSeconds : CACHE_TTL;
        await redis.setex(getChallengeIdKey(parsed.id), ttlToUse, cached);
      } catch {
        // Best-effort only; do not fail the request on cache repair.
      }

      logRequestSuccess(requestId, SERVICE_TYPE, "GET", {
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
      await redis.setex(cacheKey, FALLBACK_TTL, JSON.stringify(defaultChallenge));
      return NextResponse.json(defaultChallenge);
    }

    let stats: Awaited<ReturnType<typeof getLongTermCumulativeStats>> | null = null;
    try {
      stats = await getLongTermCumulativeStats(userId!);
    } catch {
      stats = null;
    }

    const [lastOutcome, streak] = await Promise.all([
      getLastChallengeOutcome(userId!).catch(() => null),
      getDailyChallengeStreak(userId!).catch(() => null),
    ]);

    const newChallenge = await generateDailyChallenge(
      userId!,
      finalUserLevel,
      stats
        ? {
            averageWPM: stats.averageWPM,
            averageAccuracy: stats.averageAccuracy,
            bestWPM: stats.bestWPM,
            bestAccuracy: stats.bestAccuracy,
            totalSessions: stats.totalSessions,
            totalTimeTyped: stats.totalTimeTyped,
            totalCharactersTyped: stats.totalCharactersTyped,
            lastUpdated: stats.lastUpdated,
            streak: streak?.streak,
            lastOutcome: lastOutcome
              ? {
                  date: lastOutcome.date,
                  type: lastOutcome.type,
                  status: lastOutcome.status,
                  attempts: lastOutcome.attempts,
                  streak: lastOutcome.streak,
                }
              : undefined,
          }
        : undefined
    );

    await redis
      .multi()
      .setex(cacheKey, CACHE_TTL, JSON.stringify(newChallenge))
      .setex(getChallengeIdKey(newChallenge.id), CACHE_TTL, JSON.stringify(newChallenge))
      .exec();

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", {
      userId: userId!,
      cacheStatus: "miss",
      challengeId: newChallenge.id,
      ttlSeconds: CACHE_TTL,
    });

    return NextResponse.json(newChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, {
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
  const userId = await authorizeRequest(req);
  
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, method, userId);
    await connectIfNeeded();

    const today = getTodayDate();

    // If we're hitting /daily/:challengeId, parse it so we can locate the correct cache key.
    const pathname = new URL(req.url).pathname;
    const maybeChallengeId = pathname.split("/").pop() || null;
    const challengeId = maybeChallengeId && maybeChallengeId !== "daily" ? maybeChallengeId : null;

    const parsedFromId = (() => {
      if (!challengeId) return null;
      // ID format: `${type}-${userId}-${yyyymmdd}-${random6}`
      // userId may contain hyphens and is not necessarily a UUID.
      const match = /^(speedCombo|marathon|timeAttack)-(.+)-(\d{8})-([a-z0-9]{6})$/.exec(challengeId);
      if (!match) return null;
      const [, type, idUserId, yyyymmdd] = match;
      const yyyy = yyyymmdd.slice(0, 4);
      const mm = yyyymmdd.slice(4, 6);
      const dd = yyyymmdd.slice(6, 8);
      return {
        type,
        idUserId,
        date: `${yyyy}-${mm}-${dd}`,
      };
    })();

    // Prevent cross-user updates if a challengeId is present.
    if (parsedFromId && parsedFromId.idUserId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const effectiveDate = parsedFromId?.date ?? today;
    const cacheKey = getCacheKeyForDate(userId, effectiveDate);
    const idKey = challengeId ? getChallengeIdKey(challengeId) : null;

    const [existingById, existingByDate, bodyText] = await Promise.all([
      idKey ? redis.get(idKey) : Promise.resolve(null),
      redis.get(cacheKey),
      req.text().catch((error) => {
        logRequestError(requestId, SERVICE_TYPE, error, {
          userId,
          operationPhase: "body_read",
          endpoint: "challenge_update",
        });
        return "";
      }),
    ]);

    let bodyRaw: unknown = null;
    if (bodyText) {
      try {
        bodyRaw = JSON.parse(bodyText);
      } catch (error) {
        logRequestError(requestId, SERVICE_TYPE, error, {
          userId,
          operationPhase: "json_parsing",
          bodyPreview: bodyText.slice(0, 200),
        });
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
    }

    const existing = existingById ?? existingByDate;

    // Method-specific preprocessing: accept either { progress: {...} } or direct { wpm, accuracy, completed }
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;

    type ChallengeProgress = {
      wpm?: number;
      accuracy?: number;
      completed?: boolean;
      [key: string]: unknown;
    };
    let progress: ChallengeProgress | null = null;
    if (isRecord(bodyRaw)) {
      // Client sends { session } (current) or { progress } (legacy) or direct payload
      const sessionPayload = bodyRaw["session"];
      const legacyProgressPayload = bodyRaw["progress"];

      if (isRecord(sessionPayload)) {
        progress = sessionPayload as ChallengeProgress;
      } else if (isRecord(legacyProgressPayload)) {
        progress = legacyProgressPayload as ChallengeProgress;
      } else {
        progress = bodyRaw as ChallengeProgress;
      }
    }

    if (!progress || typeof progress !== "object") {
      logRequestError(requestId, SERVICE_TYPE, "Invalid progress data", {
        userId,
        operationPhase: "progress_validation",
        hasBody: !!bodyText,
      });
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 });
    }

    if (!existing) {
      // If the URL contains a dated challengeId, a missing cache entry usually means it's expired or evicted.
      if (parsedFromId && parsedFromId.date !== today) {
        logRequestError(requestId, SERVICE_TYPE, new Error("Expired challenge"), {
          userId,
          status: 410,
          challengeDate: parsedFromId.date,
          currentDate: today,
        });
        return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
      }

      logRequestError(requestId, SERVICE_TYPE, new Error("Challenge not found"), {
        userId,
        status: 404,
        cacheKey,
        hasChallengeId: !!challengeId,
      });
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    }

    const challenge = JSON.parse(existing) as DailyChallenge;
    if (challenge.date !== today) {
      logRequestError(
        requestId,
        SERVICE_TYPE,
        new Error("Expired challenge"),
        { userId, challengeDate: challenge.date, currentDate: today }
      );
      return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
    }

    // Method-specific processing
    // Normalize session-like payload into SessionData (fill missing numeric fields with 0)
    const session = (() => {
      const existingSession = (challenge.progress ?? {}) as Partial<SessionData>;
      const input = progress as Partial<SessionData>;
      const toNum = (v: unknown, fallback: number) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : fallback;
      };

      const normalized = {
        wpm: toNum(input.wpm, existingSession.wpm ?? 0),
        accuracy: toNum(input.accuracy, existingSession.accuracy ?? 0),
        textLength: toNum(input.textLength, existingSession.textLength ?? 0),
        timeSpent: toNum(input.timeSpent, existingSession.timeSpent ?? 0),
        errors: toNum(input.errors, existingSession.errors ?? 0),
        dailyAvgWpm: toNum(input.dailyAvgWpm, existingSession.dailyAvgWpm ?? 0),
        dailyAvgAcc: toNum(input.dailyAvgAcc, existingSession.dailyAvgAcc ?? 0),
        sessionsCount: toNum(input.sessionsCount, existingSession.sessionsCount ?? 0),
        textType: input.textType ?? existingSession.textType,
      } satisfies SessionData;

      return sanitizeSessionForChallenge(normalized);
    })();

    // Update challenge.data so UI progress bars move (Header/DailyChallenge.tsx reads data.*)
    const prevData = (challenge.data ?? {}) as NonNullable<DailyChallenge["data"]>;
    const nextData: NonNullable<DailyChallenge["data"]> = { ...prevData };

    if (challenge.type === "timeAttack") {
      const prevSeconds = typeof prevData.timeSpent === "number" ? prevData.timeSpent : 0;
      nextData.timeSpent = prevSeconds + session.timeSpent;
    }

    if (challenge.type === "marathon") {
      const prevChars = typeof prevData.charactersTyped === "number" ? prevData.charactersTyped : 0;
      nextData.charactersTyped = prevChars + session.textLength;
    }

    if (challenge.type === "speedCombo") {
      const prevAttempts = typeof prevData.attempts === "number" ? prevData.attempts : 0;
      const prevBestWpm = typeof prevData.bestWpm === "number" ? prevData.bestWpm : 0;
      const prevBestAccuracy = typeof prevData.bestAccuracy === "number" ? prevData.bestAccuracy : 0;
      nextData.attempts = prevAttempts + 1;
      nextData.finalWpm = session.wpm;
      nextData.finalAccuracy = session.accuracy;
      nextData.bestWpm = Math.max(prevBestWpm, session.wpm);
      nextData.bestAccuracy = Math.max(prevBestAccuracy, session.accuracy);
    }

    // Compute status using type-appropriate progress keys (marathon expects charactersTyped)
    type StatusProgress =
      | { charactersTyped: number }
      | { timeSpent: number }
      | { wpm: number; accuracy: number };

    const statusProgress: StatusProgress =
      challenge.type === "marathon"
        ? { charactersTyped: nextData.charactersTyped ?? 0 }
        : challenge.type === "timeAttack"
          ? { timeSpent: nextData.timeSpent ?? 0 }
          : { wpm: session.wpm, accuracy: session.accuracy };

    const nextStatus = calculateChallengeStatus(challenge, statusProgress);

    if (nextStatus === 1 && challenge.type === "speedCombo" && !nextData.completedAt) {
      nextData.completedAt = new Date().toISOString();
    }

    const updatedChallenge: DailyChallenge = {
      ...challenge,
      progress: session,
      data: nextData,
      status: nextStatus,
    };

    const multi = redis.multi();
    multi.setex(cacheKey, CACHE_TTL, JSON.stringify(updatedChallenge));
    multi.setex(getChallengeIdKey(updatedChallenge.id), CACHE_TTL, JSON.stringify(updatedChallenge));
    // If the request used an id-key that differs from the stored id (e.g. regenerated challenge), keep it in sync.
    if (challengeId && challengeId !== updatedChallenge.id) {
      multi.setex(getChallengeIdKey(challengeId), CACHE_TTL, JSON.stringify(updatedChallenge));
    }
    await multi.exec();

    // Best-effort: record outcome for smarter next-day generation.
    try {
      await recordChallengeOutcomeIfCompleted(userId, updatedChallenge);
    } catch {
      // do not fail request
    }

    logRequestSuccess(requestId, SERVICE_TYPE, method, {
      userId,
      challengeId: updatedChallenge.id,
      newStatus: updatedChallenge.status,
    });

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, {
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

// Updated PATCH handler
export async function PATCH(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const userId = authResult.userId;
  
  // Add null check for userId
  if (!userId) {
    return NextResponse.json({ error: "User ID not found" }, { status: 400 });
  }
  
  try {
    const { progress, operation = 'increment' } = await req.json();
    
    if (!progress) {
      return NextResponse.json({ error: 'Progress data required' }, { status: 400 });
    }

    // Validate progress data structure
    if (typeof progress !== 'object' || progress === null) {
      return NextResponse.json({ error: 'Invalid progress data format' }, { status: 400 });
    }

    // Normalize + sanitize before atomic update
    const input = progress as Partial<SessionData>;
    const normalized: SessionData = sanitizeSessionForChallenge({
      wpm: Number(input.wpm) || 0,
      accuracy: Number(input.accuracy) || 0,
      textLength: Number(input.textLength) || 0,
      timeSpent: Number(input.timeSpent) || 0,
      errors: Number(input.errors) || 0,
      dailyAvgWpm: Number(input.dailyAvgWpm) || 0,
      dailyAvgAcc: Number(input.dailyAvgAcc) || 0,
      sessionsCount: Number(input.sessionsCount) || 0,
      textType: input.textType,
    });

    // Atomic update using Lua script
    const result = await atomicChallengeUpdate(userId, normalized, operation);

    // Best-effort: record completion outcome for adaptive generation.
    try {
      await recordChallengeOutcomeIfCompleted(userId, result);
    } catch {
      // do not fail request
    }
    
    return NextResponse.json(result);
  } catch (error) {
    logRequestError(uuidv4(), "DAILY-CHALLENGE", error, {
      userId,
      operationPhase: "PATCH_update",
    });
    
    return NextResponse.json(
      { error: "Failed to update challenge" },
      { status: 500 }
    );
  }
}

// ███ DELETE - Remove challenge ███
export async function DELETE(req: NextRequest) {
  const requestId = uuidv4();
  const userId = await authorizeRequest(req);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "DELETE", userId!);
    await connectIfNeeded();

  const cacheKey = getCacheKey(userId!);
    const exists = await redis.exists(cacheKey);

    if (!exists) {
      logRequestSuccess(requestId, SERVICE_TYPE, "DELETE", {
        userId: userId!,
        message: "No challenge found to delete",
      });
      return NextResponse.json(
        { message: "No challenge found" },
        { status: 200 }
      );
    }

    const deletedCount = await redis.del(cacheKey);

    logRequestSuccess(requestId, SERVICE_TYPE, "DELETE", {
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
    logRequestError(requestId, SERVICE_TYPE, error, {
      userId: userId!,
      operationPhase: "challenge_deletion",
    });
    return NextResponse.json(
      { error: "Failed to delete challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}
