"use client";

import { useCallback } from "react";
import { sessionStatsService } from "../services/sessionStatsService";
import { useUserSession } from "@/features/auth/hooks/useUserSession";
import { logger } from "@/log/clientLogger";

export const useSessionStats = () => {
  const { userId } = useUserSession();

  const recordSessionStats = useCallback(
    async (wpm: number, accuracy: number) => {
      if (!userId) return { dailyAvgWpm: 0, dailyAvgAcc: 0, sessionsCount: 0 };

      if (typeof wpm !== "number" || typeof accuracy !== "number") {
        logger.session.error(
          "Invalid stats values",
          new Error("Invalid stats values"),
          {
            userId,
            wpm,
            accuracy,
            context: "SESSION_STATS",
            filePath: "src/features/level/hooks/useSessionStats.ts",
          }
        );
        return null;
      }

      return sessionStatsService.recordSession(userId, wpm, accuracy);
    },
    [userId]
  );

  return { recordSessionStats };
};