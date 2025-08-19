import { NextRequest, NextResponse } from "next/server";
import redis, { connectIfNeeded } from "@/lib/redis";
import { v4 as uuidv4 } from "uuid";
import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";

const SERVICE_TYPE = "SESSION-STATS";
const FILE_PATH = "src/features/session-stats/route.ts";
const CACHE_TTL = 1800; // 30 minutes
const MAX_SESSIONS_STORED = 50;

// Helper function for authorization
const authorizeRequest = (req: NextRequest) => {
  const userId = req.headers.get("x-user-id");
  const authHeader = req.headers.get("authorization");
  
  if (!userId) return null;
  
  // Validate internal requests
  if (typeof window === "undefined" && 
      authHeader !== `Bearer ${process.env.API_INTERNAL_SECRET}`) {
    return null;
  }
  
  return userId;
};

/**
 * POST - Record a new typing session
 */
export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const userId = authorizeRequest(req);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "POST", FILE_PATH, userId);
    await connectIfNeeded();

    const sessionData = await req.json();

    // Validate session data
    const validationResult = validateSessionData(sessionData);
    if (!validationResult.isValid) {
      return NextResponse.json(
        { error: "Invalid session data", details: validationResult.errors },
        { status: 400 }
      );
    }

    // Sanitize and enrich session data
    const sanitizedSession = sanitizeSessionData(sessionData);
    const enrichedSession = {
      ...sanitizedSession,
      id: uuidv4(),
      userId,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    };

    // Store session and update statistics in parallel
    const [sessionStored, statsUpdated] = await Promise.allSettled([
      storeSession(userId, enrichedSession),
      updateUserStatistics(userId, enrichedSession),
    ]);

    if (sessionStored.status === "rejected") {
      throw new Error(`Failed to store session: ${sessionStored.reason}`);
    }

    logRequestSuccess(requestId, SERVICE_TYPE, "POST", FILE_PATH, {
      userId,
      sessionId: enrichedSession.id,
      wpm: enrichedSession.wpm,
      accuracy: enrichedSession.accuracy,
      statsUpdated: statsUpdated.status === "fulfilled",
    });

    return NextResponse.json({
      success: true,
      sessionId: enrichedSession.id,
      statistics: statsUpdated.status === "fulfilled" ? statsUpdated.value : null,
    });

  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId,
      operationPhase: "session_recording",
    });

    return NextResponse.json(
      { error: "Failed to record session", referenceId: requestId },
      { status: 500 }
    );
  }
}

/**
 * GET - Retrieve user session statistics
 */
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const userId = authorizeRequest(req);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", FILE_PATH, userId);
    await connectIfNeeded();

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || 'all'; // all, today, week, month
    const limit = parseInt(searchParams.get('limit') || '20');

    // Fetch statistics and recent sessions in parallel
    const [stats, sessions] = await Promise.allSettled([
      getUserStatistics(userId, period),
      getRecentSessions(userId, limit),
    ]);

    const response = {
      statistics: stats.status === "fulfilled" ? stats.value : getDefaultStatistics(),
      recentSessions: sessions.status === "fulfilled" ? sessions.value : [],
      period,
      generatedAt: new Date().toISOString(),
    };

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
      userId,
      period,
      sessionCount: response.recentSessions.length,
    });

    return NextResponse.json(response);

  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId,
      operationPhase: "stats_retrieval",
    });

    return NextResponse.json(
      { error: "Failed to retrieve statistics", referenceId: requestId },
      { status: 500 }
    );
  }
}

// Helper functions

/**
 * Validate incoming session data
 */
function validateSessionData(data: any) {
  const errors: string[] = [];

  // Required fields
  if (typeof data.wpm !== 'number' || data.wpm < 0) {
    errors.push('WPM must be a non-negative number');
  }

  if (typeof data.accuracy !== 'number' || data.accuracy < 0 || data.accuracy > 100) {
    errors.push('Accuracy must be between 0 and 100');
  }

  if (typeof data.textLength !== 'number' || data.textLength <= 0) {
    errors.push('Text length must be a positive number');
  }

  if (typeof data.timeSpent !== 'number' || data.timeSpent <= 0) {
    errors.push('Time spent must be a positive number');
  }

  // Reasonable bounds checking
  if (data.wpm > 300) {
    errors.push('WPM seems unrealistically high (>300)');
  }

  if (data.timeSpent > 7200) { // 2 hours
    errors.push('Session time seems unrealistically long (>2 hours)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize session data
 */
function sanitizeSessionData(data: any) {
  return {
    wpm: Math.round(data.wpm * 100) / 100, // Round to 2 decimal places
    accuracy: Math.round(data.accuracy * 100) / 100,
    textLength: Math.max(1, Math.round(data.textLength)),
    timeSpent: Math.max(1, Math.round(data.timeSpent)),
    language: data.language || 'en',
    mode: data.mode || 'normal',
    mistakes: Math.max(0, Math.round(data.mistakes || 0)),
    corrections: Math.max(0, Math.round(data.corrections || 0)),
  };
}

/**
 * Store session in Redis
 */
async function storeSession(userId: string, session: any) {
  const sessionsKey = `user:sessions:${userId}`;
  
  // Add session to the beginning of the list and trim to max size
  await redis.lPush(sessionsKey, JSON.stringify(session));
  await redis.lTrim(sessionsKey, 0, MAX_SESSIONS_STORED - 1);
  
  // Set expiration for the sessions list (30 days)
  await redis.expire(sessionsKey, 30 * 24 * 60 * 60);

  return session.id;
}

/**
 * Update user statistics based on new session
 */
async function updateUserStatistics(userId: string, session: any) {
  const statsKey = `user:stats:${userId}`;
  const existing = await redis.get(statsKey);
  
  let stats = existing ? JSON.parse(existing) : getDefaultStatistics();

  // Update statistics
  stats.totalSessions += 1;
  stats.totalTimeTyped += session.timeSpent;
  stats.totalWordsTyped += Math.round(session.wpm * (session.timeSpent / 60));
  stats.totalCharactersTyped += session.textLength;

  // Update averages
  stats.averageWPM = ((stats.averageWPM * (stats.totalSessions - 1)) + session.wpm) / stats.totalSessions;
  stats.averageAccuracy = ((stats.averageAccuracy * (stats.totalSessions - 1)) + session.accuracy) / stats.totalSessions;

  // Update bests
  if (session.wpm > stats.bestWPM) {
    stats.bestWPM = session.wpm;
    stats.bestWPMDate = session.timestamp;
  }

  if (session.accuracy > stats.bestAccuracy) {
    stats.bestAccuracy = session.accuracy;
    stats.bestAccuracyDate = session.timestamp;
  }

  // Update streak (sessions on consecutive days)
  const today = session.date;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  if (stats.lastSessionDate === yesterday || stats.lastSessionDate === today) {
    if (stats.lastSessionDate !== today) {
      stats.currentStreak += 1;
    }
  } else if (stats.lastSessionDate !== today) {
    stats.currentStreak = 1;
  }

  if (stats.currentStreak > stats.longestStreak) {
    stats.longestStreak = stats.currentStreak;
  }

  stats.lastSessionDate = today;
  stats.lastUpdated = new Date().toISOString();

  // Round averages
  stats.averageWPM = Math.round(stats.averageWPM * 100) / 100;
  stats.averageAccuracy = Math.round(stats.averageAccuracy * 100) / 100;

  // Save updated statistics
  await redis.setEx(statsKey, CACHE_TTL, JSON.stringify(stats));

  return stats;
}

/**
 * Get user statistics with optional filtering by period
 */
async function getUserStatistics(userId: string, period: string = 'all') {
  const statsKey = `user:stats:${userId}`;
  const cached = await redis.get(statsKey);
  
  if (!cached) {
    return getDefaultStatistics();
  }

  const stats = JSON.parse(cached);

  // For period-specific stats, we could fetch and filter sessions
  // For now, return all-time stats with period indicator
  return {
    ...stats,
    period,
    note: period !== 'all' ? 'Period-specific filtering not yet implemented' : undefined,
  };
}

/**
 * Get recent sessions for a user
 */
async function getRecentSessions(userId: string, limit: number = 20) {
  const sessionsKey = `user:sessions:${userId}`;
  const sessions = await redis.lRange(sessionsKey, 0, limit - 1);
  
  return sessions.map(session => JSON.parse(session));
}

/**
 * Get default statistics structure
 */
function getDefaultStatistics() {
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
    currentStreak: 0,
    longestStreak: 0,
    lastSessionDate: null,
    lastUpdated: new Date().toISOString(),
  };
}