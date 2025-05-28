"use client";

import { useCallback } from "react";
import { sessionStatsService } from "../services/sessionStatsService";
import { useUserSession } from "@/features/auth/hooks/useUserSession";

export const useSessionStats = () => {
  const { userId } = useUserSession();

  const recordSessionStats = useCallback(
    async (wpm: number, accuracy: number) => {
      // if (!userId) throw new Error("User not authenticated");
      if (!userId) return { dailyAvgWpm: 0, dailyAvgAcc: 0, sessionsCount: 0 };

      
      return sessionStatsService.recordSession(userId, wpm, accuracy);
    },
    [userId]
  );

  return { recordSessionStats };
};