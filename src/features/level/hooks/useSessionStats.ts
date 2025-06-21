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

        return await sessionStatsService.recordSession(userId, wpm, accuracy);
      } catch (error) {
        logger.session.error(
          "Failed to record session stats",
          filePath,
          error instanceof Error ? error : new Error(String(error)),
          {
            userId,
            wpm,
            accuracy,
            context: "SESSION_STATS",
          }
        );
        throw error;
      }
    },
    [userId]
  );

  return { recordSessionStats };
};