// src/features/level/services/sessionStatsService.ts
import { authFetch } from "@/features/auth/utils/authFetch";
import { sessionStatsCircuit } from "@/monitoring/circuitBreaker";
import { productionMonitor } from "@/monitoring/productionHealthMonitor";
import { sanitizeSessionData } from "./dailyChallengeService";
import { logger } from "@/log/clientLogger";
import * as Sentry from "@sentry/nextjs";

export type LongTermStats = {
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
      const sessionPayload = {
        wpm,
        accuracy,
        textLength: sessionData?.textLength || 100,
        timeSpent: sessionData?.timeSpent || 60,
        language: sessionData?.language || 'en',
        mode: sessionData?.mode || 'normal',
        mistakes: sessionData?.mistakes || 0,
        corrections: sessionData?.corrections || 0,
      };

      // Execute with circuit breaker protection
      const response = await sessionStatsCircuit.execute(
        async () => {
          return await authFetch<SessionResponse>("/api/session-stats/v1", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "X-Session-ID": sessionId,
              "X-Request-Priority": "high" // إشارة للأولوية العالية
            },
            body: JSON.stringify(sessionPayload),
            userId,
            timeout: 5000, // تقليل timeout لسرعة أكبر
          });
        },
        // Fallback function for circuit breaker
        async () => {
          logger.session.warn(
            "Using fallback session stats due to circuit breaker",
            "sessionStatsService",
            { userId, sessionId }
          );
          
          // Return calculated fallback values matching LongTermStats structure
          return {
            success: false,
            sessionId,
            longTermStats: {
              totalSessions: 1,
              totalTimeTyped: sessionPayload.timeSpent,
              totalWordsTyped: Math.round(wpm * (sessionPayload.timeSpent / 60)),
              totalCharactersTyped: sessionPayload.textLength,
              averageWPM: wpm,
              averageAccuracy: accuracy,
              bestWPM: wpm,
              bestWPMDate: new Date().toISOString(),
              bestAccuracy: accuracy,
              bestAccuracyDate: new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
            },
            sessionStored: false,
            timestamp: new Date().toISOString(),
          };
        }
      );

      // Extract longTermStats from response
      const longTermStats = response.longTermStats;

      // Record successful API health metrics
      const duration = Date.now() - startTime;
      productionMonitor.recordApiHealth('SessionStats', '/api/session-stats/v1', 'success', duration);
      
      logger.session.info(
        "Session stats recorded successfully",
        "sessionStatsService",
        { userId, sessionId, duration: `${duration}ms`, stats: longTermStats }
      );

      return longTermStats;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Record failed API health metrics
      productionMonitor.recordApiHealth('SessionStats', '/api/session-stats/v1', 'failure', duration, errorMessage);

      // Enhanced error logging with context
      logger.session.error(
        "Failed to record session stats",
        "sessionStatsService",
        error instanceof Error ? error : new Error(String(error)),
        {
          userId,
          sessionId,
          wpm,
          accuracy,
          duration: `${duration}ms`,
          errorMessage,
          circuitState: sessionStatsCircuit.getStatus().state
        }
      );

      // Capture error in Sentry with enhanced context
      Sentry.captureException(error, {
        tags: {
          service: "session-stats",
          operation: "recordSession",
          circuitState: sessionStatsCircuit.getStatus().state
        },
        user: { id: userId },
        extra: {
          sessionId,
          wpm,
          accuracy,
          duration,
          errorMessage,
        },
      });

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
      typeof stats.bestWPM === 'number' && stats.bestWPM >= 0 && stats.bestWPM <= 500 &&
      typeof stats.bestAccuracy === 'number' && stats.bestAccuracy >= 0 && stats.bestAccuracy <= 100
    );
  },

  /**
   * Gets current service health status
   * @returns Service health information
   */
  getServiceHealth() {
    return {
      circuitBreaker: sessionStatsCircuit.getStatus(),
      isHealthy: sessionStatsCircuit.getStatus().state === 'CLOSED'
    };
  }
};