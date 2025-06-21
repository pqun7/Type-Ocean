import { useState, useEffect, useRef, useCallback } from "react";
import { useWpmHistory } from "@/features/typing/hooks/useWpmHistory";
import { useUserSession } from "@/features/auth/hooks/useUserSession";
import { TextType, State } from "@/features/typing/types/typing";
import { useInterval } from "./useInterval";
import { getPreviousWpm } from "../utils/getPreviousWpm";
import { useLevel } from "@/features/level/hooks/useLevel";
import { SessionData } from "@/features/level/types/level";
import { logger } from "@/log/clientLogger";


/**
 * Core typing test logic hook managing:
 * - User input handling and validation
 * - Real-time metrics calculation (WPM, accuracy, time)
 * - Session lifecycle management
 * - Idle state detection and pause handling
 * - Historical performance tracking
 *
 * @param text - Target text for typing test
 * @param selectNewText - Function to generate new test text
 * @returns Object containing state, handlers, and metrics
 */
export default function useTypingLogic(
  text: string,
  selectNewText: (level?: TextType) => void,
  selectedLevel: TextType
) {
  // State management
  const [state, setState] = useState<State>("start");
  const [userInput, setUserInput] = useState("");
  const [isError, setIsError] = useState(false);
  const [totalErrors, setTotalErrors] = useState(0);
  const [metrics, setMetrics] = useState({
    wpm: 0,
    accuracy: 100,
    elapsedTime: 0,
  });
  const { userId, isLoading } = useUserSession();
  const filePath = "hooks/useTypingLogic.ts";

  const userIdRef = useRef(userId);
  useEffect(() => {
    if (!isLoading) userIdRef.current = userId;
  }, [userId, isLoading]);


  // Persistent references
  const startTime = useRef<number | null>(null);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  const idleState = useRef({
    isIdle: false,
    lastActiveWpm: 0,
    pausedDuration: 0,
    idleStart: null as number | null,
  });

  // Historical data management
  const {
    wpmHistory,
    startNewSession,
    addTempPoints,
    commitSession,
    rollback,
  } = useWpmHistory();

  // Derived values
  const textRef = useRef(text);
  const userInputRef = useRef(userInput);
  const sessionActive = state === "running" && !idleState.current.isIdle;

  const {
    addXP,
    calculateSessionXP,
    addXPMessage,
    level,
    recordSessionStats,
    handleDailyChallenge,
  } = useLevel();

  // Sync refs with current values
  useEffect(() => {
    textRef.current = text;
    userInputRef.current = userInput;
  }, [text, userInput]);

  /** Calculate active time accounting for pauses */
  const getActiveTime = useCallback(() => {
    return startTime.current
      ? performance.now() - startTime.current - idleState.current.pausedDuration
      : 0;
  }, []);

  /** Calculate current WPM and accuracy metrics */
  const calculateMetrics = useCallback(() => {
    const input = userInputRef.current;
    const target = textRef.current;
    const correctChars = target
      .slice(0, input.length)
      .split("")
      .filter((char, i) => char === input[i]).length;

    const accuracy = +(
      (correctChars / Math.max(input.length, 1)) *
      100
    ).toFixed(1);
    const minutes = getActiveTime() / 60000;
    const wpm = Math.round(correctChars / 5 / Math.max(minutes, 0.016667));

    return { accuracy: Math.max(0, accuracy), wpm };
  }, [getActiveTime]);

  // Session management and adding XP
  const handleSessionStart = useCallback(() => {
    setState("running");
    startTime.current = performance.now();
    startNewSession();
    addTempPoints([{ time: 0, wpm: 0, prevWpm: 0 }]);
  }, [startNewSession, addTempPoints]);

  const handleSessionEnd = useCallback(async () => {
    // Capture pre-update state for rollback
    const previousState = state;
    const previousMetrics = { ...metrics };
    const previousWpmHistory = [...wpmHistory];
    const sessionStartTime = performance.now();

    try {
      // Optimistic UI updates for all users
      const activeTime = getActiveTime();
      const { wpm, accuracy } = calculateMetrics();

      setState("end");
      setMetrics((prev) => ({
        ...prev,
        wpm,
        accuracy,
        elapsedTime: Math.floor(activeTime / 1000),
      }));

      commitSession(); // UI-related commit for all users

      // Only for authenticated users
      if (userId) {
        let sessionData: SessionData = {
          wpm,
          accuracy,
          textLength: text.length,
          textType: selectedLevel,
          timeSpent: Math.floor(activeTime / 1000),
          errors: totalErrors,
          dailyAvgWpm: 0,
          dailyAvgAcc: 0,
          sessionsCount: 0,
        };

        // Parallelize data processing and challenge handling
        const [sessionAverages, challengeResult] = await Promise.all([
          recordSessionStats!(wpm, accuracy),
          handleDailyChallenge(sessionData),
        ]);

        // Update with actual averages
        const finalSessionData: SessionData = {
          ...sessionData,
          dailyAvgWpm: sessionAverages.dailyAvgWpm,
          dailyAvgAcc: sessionAverages.dailyAvgAcc,
          sessionsCount: sessionAverages.sessionsCount,
        };

        // Process XP calculations
        const baseXP = calculateSessionXP(finalSessionData);
        const { completed, xp } = challengeResult;
        const participationXP = Math.max(15 - baseXP, 0);
        const totalXP = baseXP + xp;

        // Batch XP updates
        const updates = [];
        if (participationXP > 0) {
          updates.push(addXP(participationXP));
          updates.push(
            addXPMessage(
              "Participation Reward",
              participationXP,
              "participation"
            )
          );
        } else {
          updates.push(addXP(totalXP));
          updates.push(addXPMessage("Session Completed", totalXP, "base"));
        }

        if (completed) {
          updates.push(addXP(xp));
          updates.push(
            addXPMessage("Daily Challenge Completed", xp, "daily-challenge")
          );
        }

        // Execute all XP updates
        await Promise.all(updates);

        logger.session.info("Session completed for authenticated user",filePath, {
          userId,
          duration: performance.now() - sessionStartTime,
          wpm,
          accuracy,
          xpEarned: totalXP,
        });
      } else {
        // Guest user handling
        logger.session.info("Guest session completed", filePath,{
          wpm,
          accuracy,
          duration: performance.now() - sessionStartTime,
        });
      }
    } catch (error) {
      // Rollback procedure for UI states
      setState(previousState);
      setMetrics(previousMetrics);
      if (wpmHistory !== previousWpmHistory) {
        rollback();
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.session.error(
        "Session completion failed",filePath,
        error instanceof Error ? error : new Error(errorMessage),
        {
          userId,
          rollbackSuccess: metrics === previousMetrics && state === previousState,
        }
      );

      // Re-throw error for error boundaries
      throw new Error("Failed to complete session. Please try again.");
    }
  }, [
    // Dependencies
    getActiveTime,
    calculateMetrics,
    commitSession,
    text.length,
    selectedLevel,
    totalErrors,
    calculateSessionXP,
    recordSessionStats,
    handleDailyChallenge,
    addXP,
    addXPMessage,
    wpmHistory,
    userId, // Added for conditional execution
    state,
    metrics,
  ]);

  // Idle state management
  const handleIdleState = useCallback(
    (isIdle: boolean) => {
      if (isIdle) {
        idleState.current.idleStart = performance.now();
        idleState.current.lastActiveWpm = metrics.wpm;
      } else if (idleState.current.idleStart) {
        idleState.current.pausedDuration +=
          performance.now() - idleState.current.idleStart;
        idleState.current.idleStart = null;
      }
      idleState.current.isIdle = isIdle;
      setMetrics((prev) => ({
        ...prev,
        wpm: isIdle ? idleState.current.lastActiveWpm : prev.wpm,
      }));
    },
    [metrics.wpm]
  );

  // Regular metric updates
  useInterval(
    () => {
      if (!sessionActive) return;

      const activeTime = getActiveTime();
      const { wpm, accuracy } = calculateMetrics();

      setMetrics((prev) => ({
        wpm,
        accuracy,
        elapsedTime: Math.floor(activeTime / 1000),
      }));

      const prevWpm = getPreviousWpm(activeTime, wpmHistory);
      addTempPoints([{ time: activeTime, wpm, prevWpm }]);
    },
    sessionActive ? 2000 : null
  );

  // Input handling
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;

    if (state === "start") handleSessionStart();

    setUserInput(input);
    setIsError(text.slice(0, input.length) !== input);
    // if(isError) setTotalErrors((prv) => prv + 1);

    // if (input.length >= text.length && state !== "end") { ... }
    if (input.length === text.length) {
      // Handle async session end properly
      handleSessionEnd().catch((error) =>
        console.error("Failed to complete session:", error)
      );
    }

    // Reset idle timer on input
    idleTimer.current && clearTimeout(idleTimer.current);
    if (idleState.current.isIdle) handleIdleState(false);

    idleTimer.current = setTimeout(() => handleIdleState(true), 4000);
  };

  // Game reset
  const resetGame = useCallback(() => {
    selectNewText();
    setUserInput("");
    setIsError(false);
    setState("start");
    setMetrics({ wpm: 0, accuracy: 100, elapsedTime: 0 });

    // Reset references
    startTime.current = null;
    idleState.current = {
      isIdle: false,
      lastActiveWpm: 0,
      pausedDuration: 0,
      idleStart: null,
    };

    idleTimer.current && clearTimeout(idleTimer.current);
  }, [selectNewText]);

  return {
    userInput,
    isError,
    totalErrors,
    ...metrics,
    state,
    handleInputChange,
    resetGame,
    isIdle: idleState.current.isIdle,
    wpmHistory,
  };
}
