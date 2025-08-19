import { NextRequest, NextResponse } from "next/server";
import redis, { connectIfNeeded } from "@/lib/redis";
import { v4 as uuidv4 } from "uuid";
import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";
import { getTodayDate } from "@/features/auth/utils/timeUtils";

const SERVICE_TYPE = "SESSION-STATS";
const FILE_PATH = "src/features/session-stats/api/route.ts";
const CACHE_TTL = 3600; // 1 hour

// Type definitions
interface SessionData {
  wpm: number;
  accuracy: number;
  textLength: number;
  timeSpent: number;
  errors: number;
  timestamp: number;
}

interface DailyStats {
  totalSessions: number;
  averageWpm: number;
  averageAccuracy: number;
  bestWpm: number;
  bestAccuracy: number;
  totalCharacters: number;
  totalTime: number;
  lastUpdated: string;
  date?: string;
}

// Helper function for authorization
const authorizeRequest = (req: NextRequest): string | false => {
  const userId = req.headers.get("x-user-id");
  if (!userId || userId === "undefined" || userId === "null") {
    return false;
  }
  return userId;
};

/**
 * POST /api/session-stats - Record new session statistics
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
    const validatedSession = validateSessionData(sessionData);
    if (!validatedSession.isValid) {
      return NextResponse.json(
        { error: "Invalid session data", details: validatedSession.errors },
        { status: 400 }
      );
    }

    const today = getTodayDate();
    const statsKey = `sessionStats:${userId}:${today}`;
    
    // Get current daily stats
    const currentStats = await redis.get(statsKey);
    const stats: DailyStats = currentStats 
      ? JSON.parse(currentStats) 
      : getDefaultDailyStats();

    // Update stats with new session
    const updatedStats = updateDailyStats(stats, validatedSession.data!);
    
    // Save updated stats
    await redis.setEx(statsKey, CACHE_TTL, JSON.stringify(updatedStats));

    // Also store individual session for potential analysis
    const sessionKey = `session:${userId}:${sessionData.timestamp || Date.now()}`;
    await redis.setEx(sessionKey, 86400, JSON.stringify(validatedSession.data)); // 24 hours

    logRequestSuccess(requestId, SERVICE_TYPE, "POST", FILE_PATH, {
      userId,
      sessionWpm: validatedSession.data!.wpm,
      dailyAvgWpm: updatedStats.averageWpm,
      totalSessions: updatedStats.totalSessions
    });

    return NextResponse.json({
      success: true,
      dailyStats: updatedStats,
      sessionRecorded: true
    });

  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId,
      operationPhase: "session_recording"
    });

    return NextResponse.json(
      { error: "Failed to record session", referenceId: requestId },
      { status: 500 }
    );
  }
}

/**
 * GET /api/session-stats - Retrieve session statistics
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

    const url = new URL(req.url);
    const period = url.searchParams.get("period") || "today";
    const limit = parseInt(url.searchParams.get("limit") || "30");

    let stats: any;

    switch (period) {
      case "today":
        stats = await getTodayStats(userId);
        break;
      case "week":
        stats = await getWeekStats(userId, limit);
        break;
      case "month":
        stats = await getMonthStats(userId, limit);
        break;
      default:
        stats = await getTodayStats(userId);
    }

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
      userId,
      period,
      statsRetrieved: true
    });

    return NextResponse.json(stats);

  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId,
      operationPhase: "stats_retrieval"
    });

    return NextResponse.json(
      { error: "Failed to retrieve stats", referenceId: requestId },
      { status: 500 }
    );
  }
}

/**
 * Validate incoming session data
 */
function validateSessionData(data: any): { isValid: boolean; data?: SessionData; errors?: string[] } {
  const errors: string[] = [];

  // Required fields validation
  if (typeof data.wpm !== 'number' || data.wpm < 0 || data.wpm > 300) {
    errors.push("Invalid WPM value");
  }
  
  if (typeof data.accuracy !== 'number' || data.accuracy < 0 || data.accuracy > 100) {
    errors.push("Invalid accuracy value");
  }
  
  if (typeof data.textLength !== 'number' || data.textLength < 0) {
    errors.push("Invalid text length");
  }
  
  if (typeof data.timeSpent !== 'number' || data.timeSpent < 0) {
    errors.push("Invalid time spent");
  }
  
  if (typeof data.errors !== 'number' || data.errors < 0) {
    errors.push("Invalid error count");
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: {
      wpm: Math.round(data.wpm * 100) / 100, // Round to 2 decimal places
      accuracy: Math.round(data.accuracy * 100) / 100,
      textLength: Math.round(data.textLength),
      timeSpent: Math.round(data.timeSpent),
      errors: Math.round(data.errors),
      timestamp: data.timestamp || Date.now()
    }
  };
}

/**
 * Update daily statistics with new session
 */
function updateDailyStats(currentStats: DailyStats, sessionData: SessionData): DailyStats {
  const newSessionCount = currentStats.totalSessions + 1;
  
  // Calculate weighted averages
  const totalWpm = (currentStats.averageWpm * currentStats.totalSessions + sessionData.wpm);
  const totalAccuracy = (currentStats.averageAccuracy * currentStats.totalSessions + sessionData.accuracy);
  
  return {
    totalSessions: newSessionCount,
    averageWpm: Math.round((totalWpm / newSessionCount) * 100) / 100,
    averageAccuracy: Math.round((totalAccuracy / newSessionCount) * 100) / 100,
    bestWpm: Math.max(currentStats.bestWpm, sessionData.wpm),
    bestAccuracy: Math.max(currentStats.bestAccuracy, sessionData.accuracy),
    totalCharacters: currentStats.totalCharacters + sessionData.textLength,
    totalTime: currentStats.totalTime + sessionData.timeSpent,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Get today's statistics
 */
async function getTodayStats(userId: string): Promise<DailyStats> {
  const today = getTodayDate();
  const statsKey = `sessionStats:${userId}:${today}`;
  
  const stats = await redis.get(statsKey);
  return stats ? JSON.parse(stats) : getDefaultDailyStats();
}

/**
 * Get weekly statistics
 */
async function getWeekStats(userId: string, days: number = 7): Promise<any> {
  const stats: DailyStats[] = [];
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const statsKey = `sessionStats:${userId}:${dateStr}`;
    const dayStats = await redis.get(statsKey);
    
    if (dayStats) {
      stats.push({ ...JSON.parse(dayStats), date: dateStr });
    } else {
      stats.push({ ...getDefaultDailyStats(), date: dateStr });
    }
  }
  
  return {
    period: "week",
    dailyStats: stats.reverse(), // Oldest first
    summary: calculateSummaryStats(stats)
  };
}

/**
 * Get monthly statistics
 */
async function getMonthStats(userId: string, days: number = 30): Promise<any> {
  return getWeekStats(userId, days); // Same logic, different period
}

/**
 * Calculate summary statistics from daily stats
 */
function calculateSummaryStats(dailyStats: DailyStats[]): any {
  const validDays = dailyStats.filter(day => day.totalSessions > 0);
  
  if (validDays.length === 0) {
    return {
      totalSessions: 0,
      averageWpm: 0,
      averageAccuracy: 0,
      bestWpm: 0,
      bestAccuracy: 0,
      activeDays: 0
    };
  }
  
  const totalSessions = validDays.reduce((sum, day) => sum + day.totalSessions, 0);
  const avgWpm = validDays.reduce((sum, day) => sum + day.averageWpm, 0) / validDays.length;
  const avgAccuracy = validDays.reduce((sum, day) => sum + day.averageAccuracy, 0) / validDays.length;
  const bestWpm = Math.max(...validDays.map(day => day.bestWpm));
  const bestAccuracy = Math.max(...validDays.map(day => day.bestAccuracy));
  
  return {
    totalSessions,
    averageWpm: Math.round(avgWpm * 100) / 100,
    averageAccuracy: Math.round(avgAccuracy * 100) / 100,
    bestWpm,
    bestAccuracy,
    activeDays: validDays.length
  };
}

/**
 * Get default daily statistics
 */
function getDefaultDailyStats(): DailyStats {
  return {
    totalSessions: 0,
    averageWpm: 0,
    averageAccuracy: 0,
    bestWpm: 0,
    bestAccuracy: 0,
    totalCharacters: 0,
    totalTime: 0,
    lastUpdated: new Date().toISOString()
  };
}