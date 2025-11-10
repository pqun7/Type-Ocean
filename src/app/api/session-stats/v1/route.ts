//api/session-stats/v1/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { redis, connectIfNeeded } from "@/lib/redis";
import { enforceRateLimit } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";
import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";

const SERVICE_TYPE = "SESSION-STATS";
const LONG_TERM_TTL = 2592000; // 30 days for session history
const MAX_SESSIONS_STORED = 100;

// Helper function for authorization with internal API support
const authorizeRequest = (req: NextRequest) => {
  const userId = req.headers.get("x-user-id");
  const authHeader = req.headers.get("authorization");
  
  if (!userId) return null;
  
  // Validate internal requests
  if (typeof window === "undefined" && 
      authHeader === `Bearer ${process.env.API_INTERNAL_SECRET}`) {
    return userId;
  }
  
  // For external requests, rely on middleware authentication
  return userId;
};

/**
 * POST - Record a new typing session with cumulative long-term statistics
 */
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

  // User authentication
  const userId = authorizeRequest(req);
  if (!userId) {
    logging.warn("[STATS] Unauthorized stats update attempt", {
      ip: req.headers.get("x-forwarded-for") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      requestId,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logRequestStart(requestId, SERVICE_TYPE, "POST", userId);

  // Rate limiting
  try {
    const rateLimitResult = await enforceRateLimit(req, "/api/session-stats/v1");
    if (rateLimitResult instanceof NextResponse && rateLimitResult.status === 429) {
      return rateLimitResult;
    }
  } catch (error) {
    logging.warn("[STATS] Rate limiting error", { error, requestId, userId });
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
  let sessionData;
  try {
    sessionData = await req.json();
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

  // Comprehensive data validation
  const validationResult = validateSessionData(sessionData);
  if (!validationResult.isValid) {
    logging.warn(`[STATS] Invalid session data for ${userId}`, { 
      errors: validationResult.errors,
      requestId,
      data: sessionData
    });
    return NextResponse.json(
      { error: "Invalid session data", details: validationResult.errors },
      { status: 400 }
    );
  }

  // Sanitize and enrich session data
  const sanitizedSession = sanitizeSessionData(sessionData);
  const timestamp = new Date().toISOString();

  const enrichedSession = {
    ...sanitizedSession,
    id: uuidv4(),
    userId,
    timestamp,
  };

  try {
    // Process long-term cumulative statistics and store session in parallel
    const [longTermStats, sessionStored] = await Promise.allSettled([
      updateLongTermCumulativeStats(userId, sanitizedSession),
      storeSessionHistory(userId, enrichedSession),
    ]);

    // Check critical operations
    if (longTermStats.status === "rejected") {
      throw new Error(`Failed to update long-term stats: ${longTermStats.reason}`);
    }

    // Prepare response immediately for better performance
    const response = {
      success: true,
      sessionId: enrichedSession.id,
      longTermStats: longTermStats.status === "fulfilled" ? longTermStats.value : null,
      sessionStored: sessionStored.status === "fulfilled",
      timestamp,
    };

    // Log success asynchronously to avoid blocking response
    setImmediate(() => {
      logRequestSuccess(requestId, SERVICE_TYPE, "POST", {
        userId,
        sessionId: enrichedSession.id,
        wpm: sanitizedSession.wpm,
        accuracy: sanitizedSession.accuracy,
        endpoint,
      });

      logging.info(`[STATS] Session recorded successfully for ${userId}`, {
        sessionId: enrichedSession.id,
        wpm: sanitizedSession.wpm,
        accuracy: sanitizedSession.accuracy,
        requestId,
      });
    });

    return NextResponse.json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logging.error(`[STATS] Processing error for ${userId}`, error, {
      requestId,
      userId,
      sessionData: sanitizedSession,
      errorMessage,
    });

    logRequestError(requestId, SERVICE_TYPE, error, {
      endpoint: "session-stats",
      userId,
      operationPhase: "session_recording",
    });

    // Check if it's a Redis-specific error
    if (errorMessage.includes("Redis") || errorMessage.includes("Connection")) {
      return NextResponse.json(
        { error: "Database connection error. Please try again." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Failed to process session stats", referenceId: requestId },
      { status: 500 }
    );
  }
}

/**
 * GET - Retrieve user long-term session statistics and history
 */
export async function GET(req: NextRequest) {
  const requestId = uuidv4();

  // User authentication
  const userId = authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logRequestStart(requestId, SERVICE_TYPE, "GET", userId);

  try {
    await connectIfNeeded();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const includeHistory = searchParams.get('includeHistory') === 'true';

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

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", {
      userId,
      sessionCount: response.sessionHistory.length,
    });

    return NextResponse.json(response);

  } catch (error) {
    logging.error(`[STATS] Retrieval error for ${userId}`, error, {
      requestId,
      userId,
    });

    logRequestError(requestId, SERVICE_TYPE, error, {
      userId,
      operationPhase: "stats_retrieval",
    });

    return NextResponse.json(
      { error: "Failed to retrieve statistics", referenceId: requestId },
      { status: 500 }
    );
  }
}

// Helper Functions

/**
 * Comprehensive session data validation
 */
function validateSessionData(data: any) {
  const errors: string[] = [];

  // Required fields validation
  if (typeof data.wpm !== 'number' || data.wpm < 0) {
    errors.push('WPM must be a non-negative number');
  }

  if (typeof data.accuracy !== 'number' || data.accuracy < 0 || data.accuracy > 100) {
    errors.push('Accuracy must be between 0 and 100');
  }

  // Optional but validated fields
  if (data.textLength !== undefined && (typeof data.textLength !== 'number' || data.textLength <= 0)) {
    errors.push('Text length must be a positive number');
  }

  if (data.timeSpent !== undefined && (typeof data.timeSpent !== 'number' || data.timeSpent <= 0)) {
    errors.push('Time spent must be a positive number');
  }

  // Reasonable bounds checking
  if (data.wpm > 500) {
    errors.push('WPM seems unrealistically high (>500)');
  }

  if (data.timeSpent && data.timeSpent > 7200) { // 2 hours
    errors.push('Session time seems unrealistically long (>2 hours)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize and normalize session data
 */
function sanitizeSessionData(data: any) {
  return {
    wpm: Math.round(data.wpm * 100) / 100,
    accuracy: Math.round(data.accuracy * 100) / 100,
    textLength: data.textLength ? Math.max(1, Math.round(data.textLength)) : 0,
    timeSpent: data.timeSpent ? Math.max(1, Math.round(data.timeSpent)) : 0,
    language: data.language || 'en',
    mode: data.mode || 'normal',
    mistakes: Math.max(0, Math.round(data.mistakes || 0)),
    corrections: Math.max(0, Math.round(data.corrections || 0)),
  };
}

/**
 * Update long-term cumulative statistics (optimized for production)
 */
async function updateLongTermCumulativeStats(userId: string, session: any) {
  const statsKey = `user:longterm:${userId}`;
  const timestamp = new Date().toISOString();

  // 1. حساب بسيط قبل الإرسال
  const timeSpent = session.timeSpent || 0;
  const wordsTyped = Math.round(session.wpm * ((session.timeSpent || 60) / 60));

  try {
    // 2. استدعاء سكربت LUA (رحلة واحدة!)
    const redisResponse = await redis.updateUserStats(
      statsKey,
      String(session.wpm),
      String(session.accuracy),
      String(timeSpent),
      String(session.textLength || 0),
      String(wordsTyped),
      timestamp,
      String(LONG_TERM_TTL)
    );

    // 3. تحويل الرد (مصفوفة) إلى كائن (Object)
    const updatedStats: { [key: string]: any } = {};
    if (!redisResponse) {
      throw new Error("Redis LUA script returned null or undefined. No data received.");
    }

    for (let i = 0; i < redisResponse.length; i += 2) {
      const key = redisResponse[i];
      const value = redisResponse[i + 1];

      // 4. إعادة تحويل القيم إلى أنواعها الصحيحة
      if (key.includes("Date") || key === "lastUpdated") {
        updatedStats[key] = value;
      } else if (key === "totalSessions" || key === "totalTimeTyped" || key === "totalWordsTyped" || key === "totalCharactersTyped") {
        updatedStats[key] = parseInt(value, 10) || 0;
      } else {
        // (مثل averageWPM, averageAccuracy, bestWPM, bestAccuracy)
        updatedStats[key] = parseFloat(value) || 0;
      }
    }
    
    return updatedStats;

  } catch (error) {
    // إضافة سياق للخطأ لتسهيل التصحيح
    logging.error(`[STATS] LUA script execution failed for ${userId}`, error, {
       errorMessage: error instanceof Error ? error.message : "Unknown LUA error",
       userId,
       sessionData: session
    });
    // رمي الخطأ ليتم التقاطه في الدالة POST الرئيسية
    throw new Error(`Failed to update long-term stats via LUA: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Store session in history for detailed tracking
 */
async function storeSessionHistory(userId: string, session: any) {
  const sessionsKey = `user:sessions:${userId}`;
  
  // Add session to the beginning of the list and trim to max size
  await redis.lpush(sessionsKey, JSON.stringify(session));
  await redis.ltrim(sessionsKey, 0, MAX_SESSIONS_STORED - 1);
  
  // Set expiration for the sessions list
  await redis.expire(sessionsKey, LONG_TERM_TTL);

  return session.id;
}

/**
 * Get long-term cumulative statistics
 */
async function getLongTermCumulativeStats(userId: string) {
  const statsKey = `user:longterm:${userId}`;
  const data = await redis.hgetall(statsKey);
  
  if (!data || Object.keys(data).length === 0) {
    return getDefaultLongTermStats();
  }

  return {
    totalSessions: parseInt(String(data.totalSessions) || "0"),
    totalTimeTyped: parseInt(String(data.totalTimeTyped) || "0"),
    totalWordsTyped: parseInt(String(data.totalWordsTyped) || "0"),
    totalCharactersTyped: parseInt(String(data.totalCharactersTyped) || "0"),
    averageWPM: parseFloat(String(data.averageWPM) || "0"),
    averageAccuracy: parseFloat(String(data.averageAccuracy) || "0"),
    bestWPM: parseFloat(String(data.bestWPM) || "0"),
    bestWPMDate: String(data.bestWPMDate) || null,
    bestAccuracy: parseFloat(String(data.bestAccuracy) || "0"),
    bestAccuracyDate: String(data.bestAccuracyDate) || null,
    lastUpdated: String(data.lastUpdated) || new Date().toISOString(),
  };
}

/**
 * Get recent session history
 */
async function getSessionHistory(userId: string, limit: number = 20) {
  const sessionsKey = `user:sessions:${userId}`;
  const sessions = await redis.lrange(sessionsKey, 0, limit - 1);
  
  return sessions.map(session => JSON.parse(session));
}

/**
 * Default long-term statistics structure (without streak)
 */
function getDefaultLongTermStats() {
  return {
    totalSessions: 0,
    totalTimeTyped: 0,
    totalWordsTyped: 0,
    totalCharactersTyped: 0,
    averageWPM: 0,
    averageAccuracy: 0,
    bestWPM: 0,
    bestWPMDate: null,
    bestAccuracy: 0,
    bestAccuracyDate: null,
    lastUpdated: new Date().toISOString(),
  };
}
