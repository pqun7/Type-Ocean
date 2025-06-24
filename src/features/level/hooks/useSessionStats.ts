"use client";

import { useCallback } from "react";
import { sessionStatsService } from "../services/sessionStatsService";
import { useUserSession } from "@/features/auth/hooks/useUserSession";
import { logger } from "@/log/clientLogger";

/**
 * Custom hook to record session statistics like WPM and accuracy
 * @returns Object containing the recordSessionStats function
 */
export const useSessionStats = () => {
  const { userId } = useUserSession();
  const filePath = "src/features/level/hooks/useSessionStats.ts";

  const recordSessionStats = useCallback(
    async (wpm: number, accuracy: number) => {
      try {
        if (!userId) {
          logger.session.warn(
            "No user ID available - skipping stats recording",
            filePath,
            { context: "SESSION_STATS" }
          );
          return { dailyAvgWpm: 0, dailyAvgAcc: 0, sessionsCount: 0 };
        }

        if (typeof wpm !== "number" || typeof accuracy !== "number") {
          const error = new Error("Invalid stats values");
          logger.session.error(
            "Invalid stats values provided",
            filePath,
            error,
            {
              userId,
              wpm,
              accuracy,
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
            filePath,
            error,
            {
              userId,
              wpm,
              accuracy,
              context: "SESSION_STATS",
            }
          );
          throw error;
        }

        if (accuracy < 0 || accuracy > 100) {
          const error = new Error(`Invalid accuracy value: ${accuracy}`);
          logger.session.error(
            "Invalid accuracy value provided",
            filePath,
            error,
            {
              userId,
              wpm,
              accuracy,
              context: "SESSION_STATS",
            }
          );
          throw error;
        }

        logger.session.info(
          "Recording session stats",
          filePath,
          {
            userId,
            wpm,
            accuracy,
            context: "SESSION_STATS",
          }
        );

        const result = await sessionStatsService.recordSession(userId, wpm, accuracy);
        
        logger.session.info(
          "Session stats recorded successfully",
          filePath,
          {
            userId,
            result,
            context: "SESSION_STATS",
          }
        );

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        logger.session.error(
          "Failed to record session stats",
          filePath,
          error instanceof Error ? error : new Error(String(error)),
          {
            userId,
            wpm,
            accuracy,
            context: "SESSION_STATS",
            errorMessage,
          }
        );
        
        // Don't re-throw the error - let the session continue
        // but provide fallback values so the game doesn't break
        if (errorMessage.includes("timeout") || errorMessage.includes("connection")) {
          logger.session.warn(
            "Network issue detected, providing fallback stats",
            filePath,
            { userId, context: "SESSION_STATS" }
          );
          // Return fallback values instead of throwing
          return { dailyAvgWpm: wpm, dailyAvgAcc: accuracy, sessionsCount: 1 };
        }
        
        // For other errors, still throw but with a more user-friendly message
        throw new Error("Unable to save session statistics. Your progress is still recorded locally.");
      }
    },
    [userId]
  );

  return { recordSessionStats };
};