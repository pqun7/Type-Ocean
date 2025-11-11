// useChallengeHandler.ts
"use client";
import { useCallback, useState } from "react";
import { DailyChallenge, SessionData } from "../types/level";
import { updateDailyChallenge } from "../services/dailyChallengeService";
import { calculateChallengeStatus } from "../utils/challengeHelpers";
import { logger } from "@/log/clientLogger";

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
     if (!currentChallenge || !userId) {
      logger.challenge.debug("No challenge or user ID - skipping challenge update", {
        userId,
        hasChallenge: !!currentChallenge,
        challengeId: currentChallenge?.id
      });
      return { completed: false, xp: 0 };
    }

    setIsUpdating(true);
    setError(null);
    const prevChallenge = currentChallenge;

   
    logger.challenge.debugSensitive("Starting daily challenge update", {
      userId,
      challengeId: currentChallenge.id,
      sessionData: {
        wpm: session.wpm,
        accuracy: session.accuracy,
        textLength: session.textLength,
        timeSpent: session.timeSpent
      },
      currentProgress: currentChallenge.progress,
      currentStatus: currentChallenge.status
    });

    // Optimistic update
    const tempChallenge: DailyChallenge = {
      ...currentChallenge,
      progress: session,
      status: calculateChallengeStatus(currentChallenge, session),
    };
    setOptimisticChallenge(tempChallenge);

     logger.challenge.debug("Applied optimistic challenge update", {
      userId,
      newStatus: tempChallenge.status,
      hasProgress: !!tempChallenge.progress
    });

    try {
      const updatedChallenge = await updateDailyChallenge(
        currentChallenge.id,
        session,
        userId
      );

      const completed = updatedChallenge.status === 1;
      const xp = completed ? updatedChallenge.xp : 0;

       logger.challenge.debug("Challenge update completed successfully", {
        userId,
        challengeId: currentChallenge.id,
        completed,
        xpAwarded: xp,
        newStatus: updatedChallenge.status
      });
      
      setOptimisticChallenge(updatedChallenge);

        if (completed) {
        logger.challenge.info("Daily challenge completed", {
          userId,
          challengeId: currentChallenge.id,
          xpEarned: xp,
          sessionWpm: session.wpm,
          sessionAccuracy: session.accuracy
        });
      } else {
        logger.challenge.debug("Daily challenge progress updated", {
          userId,
          challengeId: currentChallenge.id,
          currentStatus: updatedChallenge.status,
          sessionWpm: session.wpm
        });
      }

      return { completed, xp };
    } catch (error) {
       const errorObj = error instanceof Error ? error : new Error(String(error));
      
      logger.challenge.error("Challenge update failed - rolling back optimistic update", errorObj, {
        userId,
        challengeId: currentChallenge.id,
        sessionWpm: session.wpm,
        sessionAccuracy: session.accuracy
      });

      setOptimisticChallenge(prevChallenge);
      setError(errorObj);

      logger.challenge.debug("Optimistic update rolled back", {
        userId,
        challengeRestored: prevChallenge?.id === currentChallenge.id
      });

      throw errorObj;
    } finally {
      setIsUpdating(false);
        logger.challenge.debug("Challenge update operation completed", {
        userId,
        challengeId: currentChallenge.id,
        duration: isUpdating ? "operation_finished" : "state_updated"
      });
    }
  }, [currentChallenge, userId]);

  return {
    handleDailyChallenge,
    isUpdating,
    error,
    optimisticChallenge: optimisticChallenge || currentChallenge,
  };
};
