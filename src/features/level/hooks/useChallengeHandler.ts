// useChallengeHandler.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

  // Clear optimistic state when the user changes/logs out.
  useEffect(() => {
    if (!userId) setOptimisticChallenge(null);
  }, [userId]);

  // Keep optimistic state aligned when the active challenge changes (new day / regenerated).
  // Without this, the UI can get stuck showing an older challenge/status.
  useEffect(() => {
    setOptimisticChallenge((prev) => {
      if (!currentChallenge) return null;
      if (!prev) return currentChallenge;
      if (prev.id !== currentChallenge.id) return currentChallenge;
      if (prev.date !== currentChallenge.date) return currentChallenge;
      return prev;
    });
  }, [currentChallenge?.id, currentChallenge?.date]);

  // Prevent overlapping updates when sessions end back-to-back.
  const updatingRef = useRef(false);
  const pendingSessionRef = useRef<SessionData | null>(null);

  /**
   * Handles challenge progress updates with optimistic UI pattern
   * @param session - Current gameplay session data
   * @returns Challenge completion status and XP rewards
   */
  const handleDailyChallenge = useCallback(async (session: SessionData) => {
    const activeChallenge = optimisticChallenge ?? currentChallenge;

     if (!activeChallenge || !userId) {
      logger.challenge.debug("No challenge or user ID - skipping challenge update", {
        userId,
        hasChallenge: !!activeChallenge,
        challengeId: activeChallenge?.id
      });
      return { completed: false, xp: 0 };
    }

    if (updatingRef.current) {
      pendingSessionRef.current = session;
      logger.challenge.debug("Daily challenge update queued (previous still in-flight)", {
        userId,
        challengeId: activeChallenge?.id,
      });
      return { completed: false, xp: 0 };
    }

    updatingRef.current = true;
    setIsUpdating(true);
    setError(null);
    const prevChallenge = activeChallenge;

   
    logger.challenge.debugSensitive("Starting daily challenge update", {
      userId,
      challengeId: activeChallenge.id,
      sessionData: {
        wpm: session.wpm,
        accuracy: session.accuracy,
        textLength: session.textLength,
        timeSpent: session.timeSpent
      },
      currentProgress: activeChallenge.progress,
      currentStatus: activeChallenge.status
    });

    // Optimistic update (Header/DailyChallenge.tsx reads progress from dailyChallenge.data)
    const prevData = activeChallenge.data ?? {};
    const nextData = { ...prevData } as NonNullable<DailyChallenge["data"]>;

    if (activeChallenge.type === "timeAttack") {
      nextData.timeSpent = (typeof prevData.timeSpent === "number" ? prevData.timeSpent : 0) + session.timeSpent;
    }

    if (activeChallenge.type === "marathon") {
      nextData.charactersTyped =
        (typeof prevData.charactersTyped === "number" ? prevData.charactersTyped : 0) + session.textLength;
    }

    if (activeChallenge.type === "speedCombo") {
      const prevAttempts = typeof prevData.attempts === "number" ? prevData.attempts : 0;
      const prevBestWpm = typeof prevData.bestWpm === "number" ? prevData.bestWpm : 0;
      const prevBestAccuracy = typeof prevData.bestAccuracy === "number" ? prevData.bestAccuracy : 0;

      nextData.attempts = prevAttempts + 1;
      nextData.finalWpm = session.wpm;
      nextData.finalAccuracy = session.accuracy;
      nextData.bestWpm = Math.max(prevBestWpm, session.wpm);
      nextData.bestAccuracy = Math.max(prevBestAccuracy, session.accuracy);
    }

    const statusProgress =
      activeChallenge.type === "marathon"
        ? ({ charactersTyped: nextData.charactersTyped ?? 0 } as any)
        : activeChallenge.type === "timeAttack"
          ? ({ timeSpent: nextData.timeSpent ?? 0 } as any)
          : (session as any);

    const tempChallenge: DailyChallenge = {
      ...activeChallenge,
      progress: session,
      data: nextData,
      status: calculateChallengeStatus(activeChallenge, statusProgress),
    };
    setOptimisticChallenge(tempChallenge);

     logger.challenge.debug("Applied optimistic challenge update", {
      userId,
      newStatus: tempChallenge.status,
      hasProgress: !!tempChallenge.progress
    });

    try {
      const updatedChallenge = await updateDailyChallenge(
          activeChallenge.id,
        session,
        userId
      );

      const completed = updatedChallenge.status === 1;
      const justCompleted = completed && prevChallenge.status !== 1;
      const xp = justCompleted ? updatedChallenge.xp : 0;

       logger.challenge.debug("Challenge update completed successfully", {
        userId,
        challengeId: activeChallenge.id,
        completed,
        xpAwarded: xp,
        newStatus: updatedChallenge.status
      });
      
      setOptimisticChallenge(updatedChallenge);

        if (justCompleted) {
        logger.challenge.info("Daily challenge completed", {
          userId,
          challengeId: activeChallenge.id,
          xpEarned: xp,
          sessionWpm: session.wpm,
          sessionAccuracy: session.accuracy
        });
      } else {
        logger.challenge.debug("Daily challenge progress updated", {
          userId,
          challengeId: activeChallenge.id,
          currentStatus: updatedChallenge.status,
          sessionWpm: session.wpm
        });
      }

      return { completed, xp };
    } catch (error) {
       const errorObj = error instanceof Error ? error : new Error(String(error));
      
      logger.challenge.error("Challenge update failed - rolling back optimistic update", errorObj, {
        userId,
        challengeId: activeChallenge.id,
        sessionWpm: session.wpm,
        sessionAccuracy: session.accuracy
      });

      setOptimisticChallenge(prevChallenge);
      setError(errorObj);

      logger.challenge.debug("Optimistic update rolled back", {
        userId,
        challengeRestored: prevChallenge?.id === activeChallenge.id
      });

      throw errorObj;
    } finally {
      setIsUpdating(false);
      updatingRef.current = false;

      // Flush the latest queued update (latest wins)
      const pending = pendingSessionRef.current;
      if (pending) {
        pendingSessionRef.current = null;
        // Fire-and-forget to avoid blocking UI
        setTimeout(() => {
          void handleDailyChallenge(pending);
        }, 0);
      }

      logger.challenge.debug("Challenge update operation completed", {
        userId,
        challengeId: activeChallenge.id,
      });
    }
  }, [currentChallenge, optimisticChallenge, userId]);

  return {
    handleDailyChallenge,
    isUpdating,
    error,
    optimisticChallenge: optimisticChallenge || currentChallenge,
  };
};
