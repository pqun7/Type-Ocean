//api/session-stats/v1/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { connectIfNeeded, redis } from "@/lib/redis";
import { enforceRateLimit } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";
import { authorizeRequest } from "@/app/api/shared.server";
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

  // Ensure Redis connection before proceeding
  try {
    await connectIfNeeded();
  } catch (error) {
    logging.error("Redis connection failed for session stats", error, {
      requestId,
      endpoint,
      service: SERVICE_TYPE
    });
    return NextResponse.json(
      { error: "Database connection failed. Please try again." },
      { status: 503 }
    );
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
  let sessionData;
  try {
    sessionData = await req.json();
  } catch (error) {
    logStatsOperation.error(requestId, "record_session", error, {
      userId,
      operationPhase: "json_parsing"
    });
    return NextResponse.json(
      { error: "Invalid JSON format in request body" },
      { status: 400 }
    );
  }

  // Comprehensive data validation
  const validationResult = validateSessionData(sessionData);
  if (!validationResult.isValid) {
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

  // Safe debug logging for session data
  logging.debugSensitive("Session data received", {
    requestId,
    userId,
    sessionSummary: {
      wpm: sessionData.wpm,
      accuracy: sessionData.accuracy,
      textLength: sessionData.textLength,
      timeSpent: sessionData.timeSpent
    }
  });

  // Sanitize and enrich session data
  const sanitizedSession: NormalizedSessionData = sanitizeSessionData(sessionData);
  const timestamp = new Date().toISOString();

  const enrichedSession = {
    ...sanitizedSession,
    id: uuidv4(),
    userId,
    timestamp,
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
      logStatsOperation.success(requestId, "record_session", {
        userId,
        sessionId: enrichedSession.id,
        wpm: sanitizedSession.wpm,
        accuracy: sanitizedSession.accuracy,
        endpoint,
      });

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


