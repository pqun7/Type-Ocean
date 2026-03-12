//api/session-stats/v1/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
 import type { Prisma } from "@prisma/client";
import { connectIfNeeded, redis } from "@/lib/redis";
import { enforceRateLimit } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";
import { authorizeRequest } from "@/app/api/shared.server";
import prisma from "@/features/auth/lib/db";
import { syncPlayerProfile } from "@/features/auth/server/player-profile";
import {
  DEFAULT_RATING,
  DEFAULT_RATING_DEVIATION,
  getRankInfo,
  isRatedSession,
  updatePerformanceRating,
} from "@/features/ranking/rating";
import {
  validateSessionData,
  sanitizeSessionData,
  updateLongTermCumulativeStats,
  storeSessionHistory,
  getLongTermCumulativeStats,
  getSessionHistory,
  getDefaultLongTermStats,
  NormalizedSessionData
} from "@/helper/session-stats";
import { refreshLeaderboardProfileCache } from "@/features/pvp/server/leaderboard-cache";

const SERVICE_TYPE = "SESSION-STATS";
// Constants now imported from session-stats helper module

// in api/session-stats/v1/route.ts
// Safe logging utilities for session stats
const logStatsOperation = {
  start: (requestId: string, operation: string, userId?: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Session stats operation started: ${operation}`, {
      requestId,
      service: SERVICE_TYPE,
      userId,
      ...metadata
    });
  },
  
  success: (requestId: string, operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Session stats operation completed: ${operation}`, {
      requestId,
      service: SERVICE_TYPE,
      ...metadata
    });
  },
  
  error: (requestId: string, operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Session stats operation failed: ${operation}`, error, {
      requestId,
      service: SERVICE_TYPE,
      ...metadata
    });
  }
};

// in api/session-stats/v1/route.ts
/**
 * POST - Record a new typing session with cumulative long-term statistics
 */
export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const endpoint = "/api/session-stats/v1";

  // Redis is preferred, but should not block stats persistence.
  let redisAvailable = true;
  try {
    await connectIfNeeded();
  } catch (error) {
    redisAvailable = false;
    logging.error("Redis connection failed for session stats (DB fallback enabled)", error, {
      requestId,
      endpoint,
      service: SERVICE_TYPE,
    });
  }

  // User authentication
  const userId = await authorizeRequest(req);
  if (!userId) {

    logging.warn("Unauthorized stats update attempt", {
      requestId,
      endpoint,
      ip: req.headers.get("x-forwarded-for") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      headers: {
        hasUserId: !!req.headers.get("x-user-id"),
        hasAuth: !!req.headers.get("authorization"),
        contentType: req.headers.get("content-type")
      },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logStatsOperation.start(requestId, "record_session", userId, {
    endpoint: "POST"
  });

  // Rate limiting
  try {
    const rateLimitResult = await enforceRateLimit(req, endpoint);
    if (rateLimitResult instanceof NextResponse && rateLimitResult.status === 429) {
      logStatsOperation.error(requestId, "record_session", new Error("Rate limit exceeded"), {
        userId,
        endpoint
      });
      return rateLimitResult;
    }
  } catch (error) {
    logging.warn("Rate limiting error in session stats", { 
      error, 
      requestId, 
      userId,
      service: SERVICE_TYPE
    });
  }

  // Content type validation
  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    logStatsOperation.error(requestId, "record_session", new Error("Invalid content type"), {
      userId,
      contentType
    });
    return NextResponse.json(
      { error: "Invalid content type. Expected application/json" },
      { status: 415 }
    );
  }

  // JSON parsing with error handling
  let sessionData: unknown;
  try {
    const raw = await req.text();
    const contentLengthHeader = req.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
    if (!raw) {
      logStatsOperation.error(requestId, "record_session", new Error("Empty request body"), {
        userId,
        operationPhase: "json_parsing",
        contentLength,
      });
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    try {
      sessionData = JSON.parse(raw);
    } catch (error) {
      logStatsOperation.error(requestId, "record_session", error, {
        userId,
        operationPhase: "json_parsing",
        contentLength,
        rawLength: raw.length,
        bodyPreview: raw.slice(0, 200),
      });
      return NextResponse.json(
        { error: "Invalid JSON format in request body" },
        { status: 400 }
      );
    }
  } catch (error) {
    logStatsOperation.error(requestId, "record_session", error, {
      userId,
      operationPhase: "json_parsing",
      contentLength: req.headers.get("content-length"),
    });
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 }
    );
  }

  // Comprehensive data validation
  const validationResult = validateSessionData(sessionData);
  if (!validationResult.isValid || !validationResult.data) {
    logStatsOperation.error(requestId, "record_session", new Error("Invalid session data"), {
      userId,
      validationErrors: validationResult.errors,
      operationPhase: "data_validation"
    });
    return NextResponse.json(
      { error: "Invalid session data", details: validationResult.errors },
      { status: 400 }
    );
  }

  const typedSessionData = validationResult.data;

  // Safe debug logging for session data
  logging.debugSensitive("Session data received", {
    requestId,
    userId,
    sessionSummary: {
      wpm: typedSessionData.wpm,
      accuracy: typedSessionData.accuracy,
      textLength: typedSessionData.textLength,
      timeSpent: typedSessionData.timeSpent
    }
  });

  // Sanitize and enrich session data
  const sanitizedSession: NormalizedSessionData = sanitizeSessionData(typedSessionData);
  const timestamp = new Date().toISOString();
  const { localDate: providedLocalDate, tzOffsetMinutes } = typedSessionData;
  const localDate = providedLocalDate ?? timestamp.slice(0, 10);

  const enrichedSession = {
    ...sanitizedSession,
    id: uuidv4(),
    userId,
    timestamp,
    localDate,
    tzOffsetMinutes,
  };

  // Idempotency based on X-Session-ID
  const sessionId = req.headers.get("x-session-id");
  if (sessionId) {
    const idemKey = `session:processed:${sessionId}`;
    try {
      const already = await redis.get(idemKey);
      if (already) {
        const cachedLongTerm = await getLongTermCumulativeStats(userId);
        return NextResponse.json({
          success: true,
          sessionId,
          longTermStats: cachedLongTerm,
          sessionStored: false,
          timestamp: new Date().toISOString(),
          idempotent: true
        });
      }
      await redis.setex(idemKey, 300, "1");
    } catch {
      logging.warn("Idempotency key operation failed", { sessionId, userId });
    }
  }

  try {
    // Preferred path: Redis-backed cumulative stats + history.
    // Fallback path: compute from DB snapshot when Redis is down (or Redis update fails).
    const [longTermStats, sessionStored] = redisAvailable
      ? await Promise.allSettled([
          updateLongTermCumulativeStats(userId, sanitizedSession),
          storeSessionHistory(userId, enrichedSession),
        ])
      : await Promise.allSettled([
          (async () => {
            const existing = await prisma.playerProfile.findUnique({
              where: { userId },
              select: { longTermStats: true },
            });

            const prev = (existing?.longTermStats as unknown as ReturnType<typeof getDefaultLongTermStats>) ??
              getDefaultLongTermStats();

            const prevSessions = typeof prev.totalSessions === "number" ? prev.totalSessions : 0;
            const nextTotalSessions = prevSessions + 1;
            const timeSpent = typeof sanitizedSession.timeSpent === "number" ? sanitizedSession.timeSpent : 0;
            const timeMinutes = timeSpent > 0 ? timeSpent / 60 : 0;
            const wordsTyped = Math.max(0, Math.round(sanitizedSession.wpm * timeMinutes));

            const prevTotalTimeTyped = Number(prev.totalTimeTyped ?? 0);
            const prevTotalWordsTyped = Number(prev.totalWordsTyped ?? 0);
            const nextTotalTimeTyped = prevTotalTimeTyped + timeSpent;
            const nextTotalWordsTyped = prevTotalWordsTyped + wordsTyped;

            const nextBestWpm = Math.max(Number(prev.bestWPM ?? 0), sanitizedSession.wpm);
            const nextBestWpmDate = sanitizedSession.wpm >= Number(prev.bestWPM ?? 0)
              ? new Date().toISOString()
              : (prev.bestWPMDate ?? null);

            const nextBestAcc = Math.max(Number(prev.bestAccuracy ?? 0), sanitizedSession.accuracy);
            const nextBestAccDate = sanitizedSession.accuracy >= Number(prev.bestAccuracy ?? 0)
              ? new Date().toISOString()
              : (prev.bestAccuracyDate ?? null);

            const nextAvgWpm =
              nextTotalTimeTyped > 0 ? (nextTotalWordsTyped * 60) / nextTotalTimeTyped : 0;

            const prevAccuracyTimeSum = Number((prev as any).accuracyTimeSum ?? (Number(prev.averageAccuracy ?? 0) * prevTotalTimeTyped));
            const nextAccuracyTimeSum = prevAccuracyTimeSum + (sanitizedSession.accuracy * timeSpent);
            const nextAvgAcc =
              nextTotalTimeTyped > 0 ? nextAccuracyTimeSum / nextTotalTimeTyped : sanitizedSession.accuracy;

            const prevConsistencySum = Number((prev as any).consistencySum ?? 0);
            const prevConsistencyCount = Number((prev as any).consistencyCount ?? 0);
            const sessionConsistency = (sanitizedSession as any).consistency;
            const hasSessionConsistency =
              typeof sessionConsistency === "number" && Number.isFinite(sessionConsistency);
            const nextConsistencySum = hasSessionConsistency
              ? prevConsistencySum + sessionConsistency
              : prevConsistencySum;
            const nextConsistencyCount = hasSessionConsistency
              ? prevConsistencyCount + 1
              : prevConsistencyCount;
            const nextAvgConsistency =
              nextConsistencyCount > 0 ? nextConsistencySum / nextConsistencyCount : 0;

            return {
              totalSessions: nextTotalSessions,
              totalTimeTyped: nextTotalTimeTyped,
              totalWordsTyped: nextTotalWordsTyped,
              totalCharactersTyped: Number(prev.totalCharactersTyped ?? 0) + Number(sanitizedSession.textLength ?? 0),
              totalMistakes: Number(prev.totalMistakes ?? 0) + Number(sanitizedSession.mistakes ?? 0),
              totalCorrections: Number(prev.totalCorrections ?? 0) + Number(sanitizedSession.corrections ?? 0),
              averageWPM: nextAvgWpm,
              averageAccuracy: nextAvgAcc,
              averageConsistency: nextAvgConsistency,
              consistencySum: nextConsistencySum,
              consistencyCount: nextConsistencyCount,
              accuracyTimeSum: nextAccuracyTimeSum,
              bestWPM: nextBestWpm,
              bestWPMDate: nextBestWpmDate,
              bestAccuracy: nextBestAcc,
              bestAccuracyDate: nextBestAccDate,
              lastUpdated: new Date().toISOString(),
            };
          })(),
          Promise.resolve(true),
        ]);

    // If Redis-based update failed, compute from DB snapshot and continue.
    const effectiveLongTermStats =
      longTermStats.status === "fulfilled"
        ? longTermStats.value
        : await (async () => {
            const existing = await prisma.playerProfile.findUnique({
              where: { userId },
              select: { longTermStats: true },
            });

            const prev =
              (existing?.longTermStats as unknown as ReturnType<typeof getDefaultLongTermStats>) ??
              getDefaultLongTermStats();

            const prevSessions = typeof prev.totalSessions === "number" ? prev.totalSessions : 0;
            const nextTotalSessions = prevSessions + 1;
            const timeSpent = typeof sanitizedSession.timeSpent === "number" ? sanitizedSession.timeSpent : 0;
            const timeMinutes = timeSpent > 0 ? timeSpent / 60 : 0;
            const wordsTyped = Math.max(0, Math.round(sanitizedSession.wpm * timeMinutes));

            const prevTotalTimeTyped = Number(prev.totalTimeTyped ?? 0);
            const prevTotalWordsTyped = Number(prev.totalWordsTyped ?? 0);
            const nextTotalTimeTyped = prevTotalTimeTyped + timeSpent;
            const nextTotalWordsTyped = prevTotalWordsTyped + wordsTyped;

            const nextBestWpm = Math.max(Number(prev.bestWPM ?? 0), sanitizedSession.wpm);
            const nextBestWpmDate =
              sanitizedSession.wpm >= Number(prev.bestWPM ?? 0)
                ? new Date().toISOString()
                : (prev.bestWPMDate ?? null);

            const nextBestAcc = Math.max(Number(prev.bestAccuracy ?? 0), sanitizedSession.accuracy);
            const nextBestAccDate =
              sanitizedSession.accuracy >= Number(prev.bestAccuracy ?? 0)
                ? new Date().toISOString()
                : (prev.bestAccuracyDate ?? null);

            const nextAvgWpm =
              nextTotalTimeTyped > 0 ? (nextTotalWordsTyped * 60) / nextTotalTimeTyped : 0;

            const prevAccuracyTimeSum = Number((prev as any).accuracyTimeSum ?? (Number(prev.averageAccuracy ?? 0) * prevTotalTimeTyped));
            const nextAccuracyTimeSum = prevAccuracyTimeSum + (sanitizedSession.accuracy * timeSpent);
            const nextAvgAcc =
              nextTotalTimeTyped > 0 ? nextAccuracyTimeSum / nextTotalTimeTyped : sanitizedSession.accuracy;

            const prevConsistencySum = Number((prev as any).consistencySum ?? 0);
            const prevConsistencyCount = Number((prev as any).consistencyCount ?? 0);
            const sessionConsistency = (sanitizedSession as any).consistency;
            const hasSessionConsistency =
              typeof sessionConsistency === "number" && Number.isFinite(sessionConsistency);
            const nextConsistencySum = hasSessionConsistency
              ? prevConsistencySum + sessionConsistency
              : prevConsistencySum;
            const nextConsistencyCount = hasSessionConsistency
              ? prevConsistencyCount + 1
              : prevConsistencyCount;
            const nextAvgConsistency =
              nextConsistencyCount > 0 ? nextConsistencySum / nextConsistencyCount : 0;

            return {
              totalSessions: nextTotalSessions,
              totalTimeTyped: nextTotalTimeTyped,
              totalWordsTyped: nextTotalWordsTyped,
              totalCharactersTyped:
                Number(prev.totalCharactersTyped ?? 0) + Number(sanitizedSession.textLength ?? 0),
              totalMistakes: Number(prev.totalMistakes ?? 0) + Number(sanitizedSession.mistakes ?? 0),
              totalCorrections: Number(prev.totalCorrections ?? 0) + Number(sanitizedSession.corrections ?? 0),
              averageWPM: nextAvgWpm,
              averageAccuracy: nextAvgAcc,
              averageConsistency: nextAvgConsistency,
              consistencySum: nextConsistencySum,
              consistencyCount: nextConsistencyCount,
              accuracyTimeSum: nextAccuracyTimeSum,
              bestWPM: nextBestWpm,
              bestWPMDate: nextBestWpmDate,
              bestAccuracy: nextBestAcc,
              bestAccuracyDate: nextBestAccDate,
              lastUpdated: new Date().toISOString(),
            };
          })();

    let rankForResponse: ReturnType<typeof getRankInfo> | null = null;

    // Persist snapshot to DB for reliable Profile display.
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });

      const existingProfile = await prisma.playerProfile.findUnique({
        where: { userId },
        select: {
          rating: true,
          ratingDeviation: true,
        },
      });

      const rated = isRatedSession({
        timeSpentSec: sanitizedSession.timeSpent,
        textLength: sanitizedSession.textLength,
      });

      const ratingUpdate = rated
        ? updatePerformanceRating({
            currentRating: existingProfile?.rating,
            currentDeviation: existingProfile?.ratingDeviation,
            wpm: sanitizedSession.wpm,
            accuracy: sanitizedSession.accuracy,
            consistency: sanitizedSession.consistency,
            timeSpentSec: sanitizedSession.timeSpent,
            textLength: sanitizedSession.textLength,
            mistakes: sanitizedSession.mistakes,
            corrections: sanitizedSession.corrections,
          })
        : null;

      rankForResponse = getRankInfo(
        ratingUpdate?.nextRating ?? existingProfile?.rating ?? DEFAULT_RATING
      );

      const now = new Date();
      const effectiveLongTermStatsJson = JSON.parse(
        JSON.stringify(effectiveLongTermStats)
      ) as Prisma.InputJsonValue;

      const updateData = {
        longTermStats: effectiveLongTermStatsJson,
        ...(ratingUpdate
          ? {
              rating: ratingUpdate.nextRating,
              ratingDeviation: ratingUpdate.nextDeviation,
              ratingUpdatedAt: now,
            }
          : {}),
      };

      const createData = {
        username: user?.username ?? "user",
        longTermStats: effectiveLongTermStatsJson,
        rating: ratingUpdate?.nextRating ?? DEFAULT_RATING,
        ratingDeviation: ratingUpdate?.nextDeviation ?? DEFAULT_RATING_DEVIATION,
        ...(ratingUpdate ? { ratingUpdatedAt: now } : {}),
      };

      await syncPlayerProfile({
        userId,
        username: user?.username ?? "user",
        update: updateData,
        create: createData,
      });
      void refreshLeaderboardProfileCache(userId).catch(() => {
        // ignore
      });
    } catch {
      // best-effort
    }

    // Persist per-day aggregates for profile heatmap (best-effort).
    try {
      const wpmTime = sanitizedSession.wpm * sanitizedSession.timeSpent;
      await prisma.dailyTypingActivity.upsert({
        where: {
          userId_localDate: {
            userId,
            localDate,
          },
        },
        update: {
          sessionsCount: { increment: 1 },
          totalTimeSpentSec: { increment: sanitizedSession.timeSpent },
          sumWpm: { increment: sanitizedSession.wpm },
          sumWpmTime: { increment: wpmTime },
          sumAccuracy: { increment: sanitizedSession.accuracy },
        },
        create: {
          userId,
          localDate,
          sessionsCount: 1,
          totalTimeSpentSec: sanitizedSession.timeSpent,
          sumWpm: sanitizedSession.wpm,
          sumWpmTime: wpmTime,
          sumAccuracy: sanitizedSession.accuracy,
        },
        select: { id: true },
      });
    } catch {
      // best-effort; do not block session recording
    }

    // Prepare response immediately for better performance
    const response = {
      success: true,
      sessionId: enrichedSession.id,
      longTermStats: effectiveLongTermStats,
      sessionStored: sessionStored.status === "fulfilled",
      timestamp,
      rank: rankForResponse,
    };

    // Log success asynchronously to avoid blocking response
    setImmediate(() => {
      logStatsOperation.success(requestId, "record_session", {
        userId,
        sessionId: enrichedSession.id,
        wpm: sanitizedSession.wpm,
        accuracy: sanitizedSession.accuracy,
        endpoint,
      });

      if (response.longTermStats) {
        logging.debugSensitive("Long-term averages after session", {
          requestId,
          userId,
          totals: {
            totalSessions: response.longTermStats.totalSessions,
            averageWPM: response.longTermStats.averageWPM,
            averageAccuracy: response.longTermStats.averageAccuracy,
          },
        });
      }

      // Production-safe logging
      logging.info("Session recorded successfully", {
        requestId,
        userId,
        sessionId: enrichedSession.id,
        service: SERVICE_TYPE
      });
    });

    return NextResponse.json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logStatsOperation.error(requestId, "record_session", error, {
      userId,
      sessionData: sanitizedSession,
      errorMessage,
      operationPhase: "session_processing"
    });

    // Keep old behavior for unexpected infra errors, but DB fallback should reduce this.

    return NextResponse.json(
      { error: "Failed to process session stats", referenceId: requestId },
      { status: 500 }
    );
  }
}

// in api/session-stats/v1/route.ts
/**
 * GET - Retrieve user long-term session statistics and history
 */
export async function GET(req: NextRequest) {
  const requestId = uuidv4();

  // User authentication
  const userId = await authorizeRequest(req);
  if (!userId) {
    logging.warn("Unauthorized stats retrieval attempt", {
      requestId,
      service: SERVICE_TYPE,
      ip: req.headers.get("x-forwarded-for") || "unknown"
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logStatsOperation.start(requestId, "retrieve_stats", userId, {
    endpoint: "GET"
  });

  try {
    await connectIfNeeded();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const includeHistory = searchParams.get('includeHistory') === 'true';

    // Safe debug logging for request parameters
    logging.debugSensitive("Stats retrieval parameters", {
      requestId,
      userId,
      parameters: {
        limit,
        includeHistory
      }
    });

    // Fetch data in parallel
    const [longTermStats, sessionHistory] = await Promise.allSettled([
      getLongTermCumulativeStats(userId),
      includeHistory ? getSessionHistory(userId, limit) : Promise.resolve([]),
    ]);

    const response = {
      longTermStats: longTermStats.status === "fulfilled" ? longTermStats.value : getDefaultLongTermStats(),
      sessionHistory: sessionHistory.status === "fulfilled" ? sessionHistory.value : [],
      includeHistory,
      generatedAt: new Date().toISOString(),
      userId,
    };

    logStatsOperation.success(requestId, "retrieve_stats", {
      userId,
      sessionCount: response.sessionHistory.length,
      hasLongTermStats: longTermStats.status === "fulfilled"
    });

    // Production-safe logging
    logging.info("Session stats retrieved successfully", {
      requestId,
      userId,
      sessionCount: response.sessionHistory.length,
      service: SERVICE_TYPE
    });

    return NextResponse.json(response);

  } catch (error) {
    logStatsOperation.error(requestId, "retrieve_stats", error, {
      userId,
      operationPhase: "stats_retrieval",
    });

    return NextResponse.json(
      { error: "Failed to retrieve statistics", referenceId: requestId },
      { status: 500 }
    );
  }
}


