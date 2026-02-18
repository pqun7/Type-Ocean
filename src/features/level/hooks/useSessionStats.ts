"use client";

import { useCallback, useRef } from "react";
import { sessionStatsService, type LongTermStats } from "../services/sessionStatsService";
import { logger } from "@/log/clientLogger";

/**
 * Custom hook to record session statistics with enhanced error handling and validation
 * @returns Object containing the recordSessionStats function and service health status
 */
export const useSessionStats = (userId?: string) => {

  const inFlightRef = useRef<Promise<LongTermStats> | null>(null);
  const pendingRef = useRef<{
    wpm: number;
    accuracy: number;
    sessionData?: {
      sessionId?: string;
      textLength?: number;
      timeSpent?: number;
      mistakes?: number;
      corrections?: number;
      consistency?: number;
    };
  } | null>(null);

  const buildFallback = (
    wpm: number,
    accuracy: number,
    sessionData?: {
      sessionId?: string;
      textLength?: number;
      timeSpent?: number;
      mistakes?: number;
      corrections?: number;
      consistency?: number;
    }
  ): LongTermStats => ({
    totalSessions: 1,
    totalTimeTyped: sessionData?.timeSpent || 60,
    totalWordsTyped: Math.round(wpm * ((sessionData?.timeSpent || 60) / 60)),
    totalCharactersTyped: sessionData?.textLength || 100,
    totalMistakes: sessionData?.mistakes || 0,
    totalCorrections: sessionData?.corrections || 0,
    averageWPM: Math.max(0, Math.min(500, wpm)),
    averageAccuracy: Math.max(0, Math.min(100, accuracy)),
    averageConsistency: 0,
    bestWPM: Math.max(0, Math.min(500, wpm)),
    bestWPMDate: new Date().toISOString(),
    bestAccuracy: Math.max(0, Math.min(100, accuracy)),
    bestAccuracyDate: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  });

  const recordSessionStats = useCallback(
    async (
      wpm: number,
      accuracy: number,
      sessionData?: {
        sessionId?: string;
        textLength?: number;
        timeSpent?: number;
        mistakes?: number;
        corrections?: number;
        consistency?: number;
      }
    ): Promise<LongTermStats> => {
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
            totalMistakes: 0,
            totalCorrections: 0,
            averageWPM: 0,
            averageAccuracy: 0,
            averageConsistency: 0,
            bestWPM: 0,
            bestWPMDate: null,
            bestAccuracy: 0,
            bestAccuracyDate: null,
            lastUpdated: new Date().toISOString(),
          };
        }

        // Serialize calls: if a previous session is still being recorded,
        // queue the latest one and return immediately (non-blocking).
        if (inFlightRef.current) {
          pendingRef.current = { wpm, accuracy, sessionData };
          logger.session.debug("Session stats request queued (previous still in-flight)", {
            userId,
            sessionId: sessionData?.sessionId,
            context: "SESSION_STATS",
          });
          return buildFallback(wpm, accuracy, sessionData);
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

        const requestPromise = sessionStatsService.recordSession(
          userId,
          wpm,
          accuracy,
          {
            sessionId: sessionData?.sessionId || crypto.randomUUID(),
            timestamp: Date.now(),
            textLength: sessionData?.textLength,
            timeSpent: sessionData?.timeSpent,
            mistakes: sessionData?.mistakes,
            corrections: sessionData?.corrections,
            consistency: sessionData?.consistency,
          }
        );

        inFlightRef.current = requestPromise;

        const result = await requestPromise;
        
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
            totalMistakes: sessionData?.mistakes || 0,
            totalCorrections: sessionData?.corrections || 0,
            averageWPM: Math.max(0, Math.min(500, wpm)),
            averageAccuracy: Math.max(0, Math.min(100, accuracy)),
            averageConsistency: 0,
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

        const isNetworkish =
          errorMessage.includes("timeout") ||
          errorMessage.includes("Request timeout") ||
          errorMessage.includes("connection") ||
          errorMessage.includes("Circuit breaker") ||
          errorMessage.includes("Too many requests") ||
          errorMessage.includes("Server error");

        // Background telemetry: avoid surfacing as a noisy red console error.
        const meta = {
          userId,
          wpm,
          accuracy,
          sessionId: sessionData?.sessionId,
          context: "SESSION_STATS",
          errorMessage,
          serviceHealth: sessionStatsService.getServiceHealth(),
        };

        if (isNetworkish) {
          logger.session.warn("Failed to record session stats", meta);
        } else {
          logger.session.error("Failed to record session stats", new Error(errorMessage), meta);
        }
        
        // Enhanced fallback handling based on error type
        return buildFallback(wpm, accuracy, sessionData);
      } finally {
        // Release in-flight lock and flush a single pending request (latest wins)
        if (inFlightRef.current) {
          inFlightRef.current = null;
        }

        const pending = pendingRef.current;
        if (pending && userId) {
          pendingRef.current = null;
          // Fire-and-forget: do not block UI; serialize naturally.
          void (async () => {
            try {
              await recordSessionStats(pending.wpm, pending.accuracy, pending.sessionData);
            } catch {
              // Swallow: recordSessionStats already handles fallback/logging.
            }
          })();
        }
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