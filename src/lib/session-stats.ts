// src/lib/session-stats.ts
// Centralized helper functions and constants for session statistics

import { redis } from "@/lib/redis";
import { logging } from "@/log/ServerLogger";

export const LONG_TERM_TTL = 2592000; // 30 days for session history
export const MAX_SESSIONS_STORED = 100;

/**
 * Comprehensive session data validation
 */
// Raw session payload structure (incoming request body)
export interface SessionInputData {
  wpm: number;
  accuracy: number;
  textLength?: number;
  timeSpent?: number;
  language?: string;
  mode?: string;
  mistakes?: number;
  corrections?: number;
}

// Normalized/sanitized session structure used internally
export interface NormalizedSessionData {
  wpm: number;
  accuracy: number;
  textLength: number;
  timeSpent: number;
  language: string;
  mode: string;
  mistakes: number;
  corrections: number;
}

// Enriched session stored in history
export interface EnrichedSession extends NormalizedSessionData {
  id: string;
  userId: string;
  timestamp: string;
}

// Long-term cumulative statistics structure
export interface LongTermStats {
  totalSessions: number;
  totalTimeTyped: number;
  totalWordsTyped: number;
  totalCharactersTyped: number;
  averageWPM: number;
  averageAccuracy: number;
  bestWPM: number;
  bestWPMDate: string | null;
  bestAccuracy: number;
  bestAccuracyDate: string | null;
  lastUpdated: string;
}

export function validateSessionData(data: SessionInputData) {
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
export function sanitizeSessionData(data: SessionInputData): NormalizedSessionData {
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
export async function updateLongTermCumulativeStats(userId: string, session: NormalizedSessionData): Promise<LongTermStats> {
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
  const updatedStats: Partial<LongTermStats> = {};
    if (!redisResponse) {
      throw new Error("Redis LUA script returned null or undefined. No data received.");
    }

    for (let i = 0; i < redisResponse.length; i += 2) {
      const key = String(redisResponse[i]);
      const value = redisResponse[i + 1];

      // 4. إعادة تحويل القيم إلى أنواعها الصحيحة مع تعيين صارم للخصائص
      switch (key) {
        case 'lastUpdated':
          updatedStats.lastUpdated = String(value);
          break;
        case 'bestWPMDate':
          updatedStats.bestWPMDate = String(value);
          break;
        case 'bestAccuracyDate':
          updatedStats.bestAccuracyDate = String(value);
          break;
        case 'totalSessions':
          updatedStats.totalSessions = parseInt(String(value), 10) || 0;
          break;
        case 'totalTimeTyped':
          updatedStats.totalTimeTyped = parseInt(String(value), 10) || 0;
          break;
        case 'totalWordsTyped':
          updatedStats.totalWordsTyped = parseInt(String(value), 10) || 0;
          break;
        case 'totalCharactersTyped':
          updatedStats.totalCharactersTyped = parseInt(String(value), 10) || 0;
          break;
        case 'averageWPM':
          updatedStats.averageWPM = parseFloat(String(value)) || 0;
          break;
        case 'averageAccuracy':
          updatedStats.averageAccuracy = parseFloat(String(value)) || 0;
          break;
        case 'bestWPM':
          updatedStats.bestWPM = parseFloat(String(value)) || 0;
          break;
        case 'bestAccuracy':
          updatedStats.bestAccuracy = parseFloat(String(value)) || 0;
          break;
        default:
          // ignore unknown fields to keep typing strict
          break;
      }
    }
    
    // At this point updatedStats should have all required properties; we coerce with defaults
    return {
      totalSessions: updatedStats.totalSessions ?? 0,
      totalTimeTyped: updatedStats.totalTimeTyped ?? 0,
      totalWordsTyped: updatedStats.totalWordsTyped ?? 0,
      totalCharactersTyped: updatedStats.totalCharactersTyped ?? 0,
      averageWPM: updatedStats.averageWPM ?? 0,
      averageAccuracy: updatedStats.averageAccuracy ?? 0,
      bestWPM: updatedStats.bestWPM ?? 0,
      bestWPMDate: updatedStats.bestWPMDate ?? null,
      bestAccuracy: updatedStats.bestAccuracy ?? 0,
      bestAccuracyDate: updatedStats.bestAccuracyDate ?? null,
      lastUpdated: (updatedStats.lastUpdated as string) ?? new Date().toISOString(),
    };

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
export async function storeSessionHistory(userId: string, session: EnrichedSession): Promise<string> {
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
export async function getLongTermCumulativeStats(userId: string): Promise<LongTermStats> {
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
export async function getSessionHistory(userId: string, limit: number = 20): Promise<EnrichedSession[]> {
  const sessionsKey = `user:sessions:${userId}`;
  const sessions = await redis.lrange(sessionsKey, 0, limit - 1);
  
  return sessions.map(session => JSON.parse(session));
}

/**
 * Default long-term statistics structure (without streak)
 */
export function getDefaultLongTermStats(): LongTermStats {
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
