// useChallengeHandler.ts
"use client";
import { useCallback, useState } from "react";
import { DailyChallenge, SessionData } from "../types/level";
import { updateDailyChallenge } from "../services/dailyChallengeService";
import { logger } from "@/log/clientLogger";
import { calculateChallengeStatus } from "../utils/challengeHelpers";

/**
 * Custom hook for handling daily challenge operations with optimistic updates
 * @param userId - Current user identifier
 * @param currentChallenge - Active challenge data
 * @returns Challenge handler methods and state
 */
export const useChallengeHandler = (
  userId?: string,
  currentChallenge?: DailyChallenge | null
) => {
  // State management for challenge updates
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [optimisticChallenge, setOptimisticChallenge] =
    useState(currentChallenge);
  const filePath = "hooks/useChallengeHandler"

  /**
   * Handles challenge progress updates with optimistic UI pattern
   * @param session - Current gameplay session data
   * @returns Challenge completion status and XP rewards
   */
  const handleDailyChallenge = useCallback(
    async (session: SessionData) => {
      if (!currentChallenge || !userId) return { completed: false, xp: 0 };

      setIsUpdating(true);
      setError(null);

      // Store current state for potential rollback
      const prevChallenge = currentChallenge;

      // Immediate UI update with local state
      // const tempChallenge: DailyChallenge = {
      //   ...currentChallenge,
      //   progress: session,
      //   status: calculateChallengeStatus(currentChallenge, session) as 0 | 1
      // };
      // setOptimisticChallenge(tempChallenge);

      const tempChallenge: DailyChallenge = {
        ...currentChallenge,
        progress: session,
        status: -1 as any, // حالة مؤقتة
      };
      
      setOptimisticChallenge(tempChallenge);

      try {
        // Persist changes to backend
        const result = await updateDailyChallenge(
          currentChallenge.id,
          session,
          userId
        );

        if (!result || !result.updatedChallenge) {
          throw new Error("Invalid server response");
        }

        // Update with server response
        setOptimisticChallenge(result.updatedChallenge);
        return result;
      } catch (error) {
        // Handle errors gracefully with optimistic UI
        logger.challenge.error("Failed to update challenge",filePath ,error instanceof Error ? error : undefined);
        await new Promise((resolve) => setTimeout(resolve, 500));
        setOptimisticChallenge(currentChallenge);

        // Revert to previous state on failure
        setOptimisticChallenge(prevChallenge);
        const err =
          error instanceof Error ? error : new Error("Challenge update failed");
        logger.challenge.error("Challenge update failed", filePath , err);
        setError(err);
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [currentChallenge, userId]
  );

  return {
    handleDailyChallenge,
    isUpdating,
    error,
    optimisticChallenge: optimisticChallenge || currentChallenge,
  };
};
