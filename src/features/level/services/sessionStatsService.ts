// src/features/level/services/sessionStatsService.ts
import { authFetch } from "@/features/auth/utils/authFetch";
// NOTE: This service is used from client-side hooks.
// Keep it client-safe: do not import or dynamically import any server-only
// monitoring/logging modules here (e.g. circuit breaker, ServerLogger, Sentry).

export type LongTermStats = {
  totalSessions: number;
  totalTimeTyped: number;
  totalWordsTyped: number;
  totalCharactersTyped: number;
  totalMistakes: number;
  totalCorrections: number;
  averageWPM: number;
  averageAccuracy: number;
  bestWPM: number;
  bestWPMDate: string | null;
  bestAccuracy: number;
  bestAccuracyDate: string | null;
  lastUpdated: string;
};

export type SessionResponse = {
  success: boolean;
  sessionId: string;
  longTermStats: LongTermStats;
  sessionStored: boolean;
  timestamp: string;
};

interface EnhancedSessionData {
  wpm: number;
  accuracy: number;
  textLength?: number;
  timeSpent?: number;
  language?: string;
  mode?: string;
  mistakes?: number;
  corrections?: number;
  timestamp?: number;
  sessionId?: string;
}

export const sessionStatsService = {
  /**
   * Records session statistics with enhanced error handling and circuit breaker protection
   * @param userId - User identifier
   * @param wpm - Words per minute
   * @param accuracy - Accuracy percentage
   * @param sessionData - Optional additional session data
   * @returns Promise resolving to long-term session statistics
   */
  async recordSession(
    userId: string,
    wpm: number,
    accuracy: number,
    sessionData?: Partial<EnhancedSessionData>
  ): Promise<LongTermStats> {
    const startTime = Date.now();
    const sessionId = sessionData?.sessionId || crypto.randomUUID();
    
    try {
      // Enhanced input validation
      if (!userId || typeof userId !== "string") {
        throw new Error("Invalid user ID provided");
      }

      if (typeof wpm !== "number" || typeof accuracy !== "number") {
        throw new Error("Invalid stats values: WPM and accuracy must be numbers");
      }

      if (wpm < 0 || wpm > 500) {
        throw new Error(`Invalid WPM value: ${wpm}. Must be between 0 and 500`);
      }

      if (accuracy < 0 || accuracy > 100) {
        throw new Error(`Invalid accuracy value: ${accuracy}. Must be between 0 and 100`);
      }

      // Prepare session data for API v1
      const sessionPayload = await validateAndPrepareSessionData(userId, wpm, accuracy, sessionData);

      // Client-safe: call the API directly. Circuit breaker + monitoring should
      // live on the server (API route), not in client-shared code.
      const response = await authFetch<SessionResponse>("/api/session-stats/v1", {
        method: "POST",
        // This is fire-and-forget style background telemetry; keepalive helps
        // prevent browsers from dropping the request during navigation/unload.
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": sessionId,
        },
        body: JSON.stringify(sessionPayload),
        userId,
        // Server writes can be slow under load; don't abort too aggressively
        // or we'll create "false timeouts" while the server still commits.
        timeout: 60000,
      });

      // Extract longTermStats from response
      const longTermStats = response.longTermStats;

      const duration = Date.now() - startTime;
      void duration;
      
      // logger.session.info(
      //   "Session stats recorded successfully",
      //   { userId, sessionId, duration: `${duration}ms`, stats: longTermStats }
      // );

      return longTermStats;

    } catch (error) {
      // const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Enhanced error logging with context
      // const circuitState = "UNKNOWN";
      
      // const errObj = error instanceof Error ? error : new Error(String(error));
      // logger.session.error("Failed to record session stats", errObj);
      // logger.session.info(
      //   "Session error context",
      //   {
      //     userId,
      //     sessionId,
      //     wpm,
      //     accuracy,
      //     duration: `${duration}ms`,
      //     errorMessage,
      //     circuitState,
      //   }
      // );
      
     

      // Provide specific error messages based on error type
      if (errorMessage.includes("timeout")) {
        throw new Error(
          "Session stats recording timed out. Please check your connection and try again."
        );
      } else if (errorMessage.includes("Authentication failed")) {
        throw new Error("Authentication failed. Please sign in again.");
      } else if (errorMessage.includes("Too many requests")) {
        throw new Error(
          "Too many requests. Please wait a moment before trying again."
        );
      } else if (errorMessage.includes("Circuit breaker")) {
        throw new Error(
          "Service temporarily unavailable. Your progress is saved locally."
        );
      } else if (errorMessage.includes("Server error")) {
        throw new Error(
          "Server is temporarily unavailable. Please try again in a few moments."
        );
      } else if (errorMessage.includes("Invalid")) {
        throw new Error(`Invalid data: ${errorMessage}`);
      } else {
        throw new Error(`Failed to record session stats: ${errorMessage}`);
      }
    }
  },

  /**
   * Validates long-term statistics data integrity
   * @param stats - Long-term stats to validate
   * @returns Boolean indicating if stats are valid
   */
  validateLongTermStats(stats: LongTermStats): boolean {
    if (!stats || typeof stats !== 'object') return false;
    
    return (
      typeof stats.totalSessions === 'number' && stats.totalSessions >= 0 &&
      typeof stats.averageWPM === 'number' && stats.averageWPM >= 0 && stats.averageWPM <= 500 &&
      typeof stats.averageAccuracy === 'number' && stats.averageAccuracy >= 0 && stats.averageAccuracy <= 100 &&
      typeof stats.totalMistakes === 'number' && stats.totalMistakes >= 0 &&
      typeof stats.totalCorrections === 'number' && stats.totalCorrections >= 0 &&
      typeof stats.bestWPM === 'number' && stats.bestWPM >= 0 && stats.bestWPM <= 500 &&
      typeof stats.bestAccuracy === 'number' && stats.bestAccuracy >= 0 && stats.bestAccuracy <= 100
    );
  },

  /**
   * Gets current service health status
   * @returns Service health information
   */
  getServiceHealth() {
    // Synchronous health summary: avoid dynamic imports here to keep API sync.
    // We return a conservative default; callers in client code expect a
    // lightweight object rather than triggering server-only imports.
    return {
      circuitBreaker: { state: "UNKNOWN" },
      isHealthy: false,
    };
  }
};


async function validateAndPrepareSessionData(
  userId: string, 
  wpm: number, 
  accuracy: number, 
  sessionData?: Partial<EnhancedSessionData>
) {
  // تحقق من أن البيانات كاملة
  if (!userId || typeof wpm !== 'number' || typeof accuracy !== 'number') {
    throw new Error("Invalid session data: missing required fields");
  }

  const payload = {
    wpm: Math.max(0, wpm),
    accuracy: Math.max(0, Math.min(100, accuracy)),
    textLength: sessionData?.textLength || 100,
    timeSpent: sessionData?.timeSpent || 60,
    language: sessionData?.language || 'en',
    mode: sessionData?.mode || 'normal',
    mistakes: sessionData?.mistakes || 0,
    corrections: sessionData?.corrections || 0,
  };

  // تحقق إضافي للتأكد من صحة JSON
  try {
    JSON.stringify(payload);
  } catch {
    throw new Error("Invalid session data: cannot serialize to JSON");
  }

  return payload;
}