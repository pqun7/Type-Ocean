"use client";

import { useCallback } from "react";
import { sessionStatsService, type LongTermStats } from "../services/sessionStatsService";
import { useUserSession } from "@/features/auth/hooks/useUserSession";
import { logger } from "@/log/clientLogger";

/**
 * Custom hook to record session statistics with enhanced error handling and validation
 * @returns Object containing the recordSessionStats function and service health status
 */
export const useSessionStats = () => {
  const { userId } = useUserSession();

  const recordSessionStats = useCallback(
    async (wpm: number, accuracy: number, sessionData?: { sessionId?: string; textLength?: number; timeSpent?: number }): Promise<LongTermStats> => {
      try {
        if (!userId) {
          logger.session.warn(
            "No user ID available - skipping stats recording",
            { context: "SESSION_STATS", sessionId: sessionData?.sessionId }
          );
          
          // Return default long-term stats structure
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

        // Client-side validation before sending to service
        if (typeof wpm !== "number" || typeof accuracy !== "number") {
          const error = new Error("Invalid stats values");
          logger.session.error(
            "Invalid stats values provided",
            error,
            {
              userId,
              wpm,
              accuracy,
              sessionId: sessionData?.sessionId,
              context: "SESSION_STATS",
            }
          );
          throw error;
        }

        // Additional validation for reasonable values
        if (wpm < 0 || wpm > 500) {
          const error = new Error(`Invalid WPM value: ${wpm}`);
          logger.session.error(
            "Invalid WPM value provided",
            error,
            {
              userId,
              wpm,
              accuracy,
              sessionId: sessionData?.sessionId,
              context: "SESSION_STATS",
            }
          );
          throw error;
        }

        if (accuracy < 0 || accuracy > 100) {
          const error = new Error(`Invalid accuracy value: ${accuracy}`);
          logger.session.error(
            "Invalid accuracy value provided",
            error,
            {
              userId,
              wpm,
              accuracy,
              sessionId: sessionData?.sessionId,
              context: "SESSION_STATS",
            }
          );
          throw error;
        }

        logger.session.info(
          "Recording session stats",
          
          {
            userId,
            wpm,
            accuracy,
            sessionId: sessionData?.sessionId,
            context: "SESSION_STATS",
          }
        );

        // Use enhanced service with circuit breaker protection
        const result = await sessionStatsService.recordSession(
          userId, 
          wpm, 
          accuracy,
          { 
            sessionId: sessionData?.sessionId || crypto.randomUUID(), 
            timestamp: Date.now(),
            textLength: sessionData?.textLength,
            timeSpent: sessionData?.timeSpent,
          }
        );
        
        // Validate response data integrity
        if (!sessionStatsService.validateLongTermStats(result)) {
          logger.session.warn(
            "Received invalid long-term stats response",
            { userId, sessionId: sessionData?.sessionId, result, context: "SESSION_STATS" }
          );
          
          // Return sanitized fallback values
          return {
            totalSessions: 1,
            totalTimeTyped: sessionData?.timeSpent || 60,
            totalWordsTyped: Math.round(wpm * ((sessionData?.timeSpent || 60) / 60)),
            totalCharactersTyped: sessionData?.textLength || 100,
            averageWPM: Math.max(0, Math.min(500, wpm)),
            averageAccuracy: Math.max(0, Math.min(100, accuracy)),
            bestWPM: wpm,
            bestWPMDate: new Date().toISOString(),
            bestAccuracy: accuracy,
            bestAccuracyDate: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
          };
        }
        
        logger.session.info(
          "Session stats recorded successfully",
          
          {
            userId,
            sessionId: sessionData?.sessionId,
            result,
            context: "SESSION_STATS",
          }
        );

        return result;
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        logger.session.error(
          "Failed to record session stats",
          
          error instanceof Error ? error : new Error(String(error)),
          {
            userId,
            wpm,
            accuracy,
            sessionId: sessionData?.sessionId,
            context: "SESSION_STATS",
            errorMessage,
            serviceHealth: sessionStatsService.getServiceHealth()
          }
        );
        
        // Enhanced fallback handling based on error type
        if (errorMessage.includes("timeout") || 
            errorMessage.includes("connection") || 
            errorMessage.includes("Circuit breaker")) {
          
          logger.session.warn(
            "Network/service issue detected, providing fallback stats",
            { userId, sessionId: sessionData?.sessionId, context: "SESSION_STATS", errorType: "network" }
          );
          
          // Return calculated fallback values with local validation
          return { 
            totalSessions: 1,
            totalTimeTyped: sessionData?.timeSpent || 60,
            totalWordsTyped: Math.round(wpm * ((sessionData?.timeSpent || 60) / 60)),
            totalCharactersTyped: sessionData?.textLength || 100,
            averageWPM: Math.max(0, Math.min(500, wpm)), 
            averageAccuracy: Math.max(0, Math.min(100, accuracy)), 
            bestWPM: wpm,
            bestWPMDate: new Date().toISOString(),
            bestAccuracy: accuracy,
            bestAccuracyDate: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
          };
        }
        
        // For authentication or validation errors, provide user-friendly message
        if (errorMessage.includes("Authentication") || errorMessage.includes("Invalid")) {
          throw new Error("Unable to save session statistics. Please refresh and try again.");
        }
        
        // For other errors, provide generic fallback
        throw new Error("Unable to save session statistics. Your progress is still recorded locally.");
      }
    },
    [userId]
  );

  /**
   * Gets current service health status
   */
  const getServiceHealth = useCallback(() => {
    return sessionStatsService.getServiceHealth();
  }, []);

  /**
   * Validates if the service is currently healthy
   */
  const isServiceHealthy = useCallback(() => {
    return sessionStatsService.getServiceHealth().isHealthy;
  }, []);

  return { 
    recordSessionStats, 
    getServiceHealth, 
    isServiceHealthy 
  };
};