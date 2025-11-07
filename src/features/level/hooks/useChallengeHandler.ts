// useChallengeHandler.ts
"use client";
import { useCallback, useState } from "react";
import { DailyChallenge, SessionData } from "../types/level";
import { updateDailyChallenge } from "../services/dailyChallengeService";
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

  /**
   * Handles challenge progress updates with optimistic UI pattern
   * @param session - Current gameplay session data
   * @returns Challenge completion status and XP rewards
   */
  const handleDailyChallenge = useCallback(async (session: SessionData) => {
    if (!currentChallenge || !userId) return { completed: false, xp: 0 };

    setIsUpdating(true);
    setError(null);
    const prevChallenge = currentChallenge;

    // Optimistic update
    const tempChallenge: DailyChallenge = {
      ...currentChallenge,
      progress: session,
      status: calculateChallengeStatus(currentChallenge, session),
    };
    setOptimisticChallenge(tempChallenge);

    try {
      const updatedChallenge = await updateDailyChallenge(
        currentChallenge.id,
        session,
        userId
      );

      const completed = updatedChallenge.status === 1;
      const xp = completed ? updatedChallenge.xp : 0;
      
      setOptimisticChallenge(updatedChallenge);
      return { completed, xp };
    } catch (error) {
      setOptimisticChallenge(prevChallenge);
      const err = error instanceof Error ? error : new Error("Update failed");
      setError(err);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  }, [currentChallenge, userId]);

  return {
    handleDailyChallenge,
    isUpdating,
    error,
    optimisticChallenge: optimisticChallenge || currentChallenge,
  };
};
