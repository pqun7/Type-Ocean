// useDailyChallenge.ts
"use client";

import { useEffect, useState } from "react";
import { DailyChallenge } from "../types/level";
import { fetchDailyChallenge } from "@/features/level/services/dailyChallengeService";
import { logger } from "@/log/clientLogger";

/**
 * Hook for loading and managing daily challenge data
 * @param userId - Current user identifier
 * @returns Daily challenge state and loading status
 */
export const useDailyChallengeLoader = (userId?: string) => {
  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(null);
  const filePath = "hooks/useDailyChallenge.ts";
  useEffect(() => {
    const abortController = new AbortController();
    const requestId = crypto.randomUUID();

    const loadChallenge = async () => {
      if (!userId) return;

      try {
        logger.challenge.info("Loading daily challenge",filePath ,{ requestId, userId });
        const challenge = await fetchDailyChallenge(userId, abortController, requestId);
        setDailyChallenge(challenge);
      } catch (error) {
        // Error handling and logging
        if (error instanceof Error) {
          logger.challenge.error("Failed to load challenge",filePath, error);
        } else {
          logger.challenge.error("Failed to load challenge",filePath, new Error(String(error)));
        }
        setDailyChallenge(null);
      }
    };

    loadChallenge();
    return () => abortController.abort();
  }, [userId]);

  return { dailyChallenge };
};