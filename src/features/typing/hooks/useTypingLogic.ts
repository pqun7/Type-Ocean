import { useState, useEffect, useRef, useCallback } from "react";
import { useWpmHistory } from "@/features/typing/hooks/useWpmHistory";
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
  // Session errors = current, uncorrected mismatches (decreases when user fixes mistakes)
  const [totalErrors, setTotalErrors] = useState(0);
  // Mistakes = cumulative wrong keypresses (kept for stats even if corrected)
  const [totalMistakes, setTotalMistakes] = useState(0);
  const [totalCorrections, setTotalCorrections] = useState(0);
  const [metrics, setMetrics] = useState({
    wpm: 0,
    accuracy: 100,
    elapsedTime: 0,
  });

  const levelContext = useLevel();
  const userId = levelContext.userId ?? undefined;
  const isLoading = !!levelContext.isLoadingSession;
 
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

  const mistakesRef = useRef(0);
  const correctionsRef = useRef(0);

  const {
    addXP,
    calculateSessionXP,
    addXPMessage,
    recordSessionStats,
    handleDailyChallenge,
  } = levelContext;

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

  const handleSessionEnd = useCallback(async (counts?: { finalErrors?: number; mistakes?: number; corrections?: number }) => {
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

      // Persist last result for smarter text selection on the client.
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(
            `typing:lastResult:${selectedLevel}`,
            JSON.stringify({
              wpm,
              accuracy,
              ts: Date.now(),
              textLength: text.length,
            })
          );
        }
      } catch {
        // Ignore storage failures (private mode, quota, etc.)
      }

      commitSession(); // UI-related commit for all users

      // Only for authenticated users
      if (userId) {
        const timeSpentSeconds = Math.floor(activeTime / 1000);

        const inputNow = userInputRef.current;
        const targetNow = textRef.current;
        let computedErrors = 0;
        for (let i = 0; i < inputNow.length; i += 1) {
          if (targetNow[i] !== inputNow[i]) computedErrors += 1;
        }

        const finalErrors = Math.max(0, counts?.finalErrors ?? computedErrors);
        const sessionMistakes = Math.max(0, counts?.mistakes ?? mistakesRef.current);
        const sessionCorrections = Math.max(0, counts?.corrections ?? correctionsRef.current);

        // Build the minimal session payload synchronously so XP can be awarded immediately.
        const sessionData: SessionData = {
          wpm,
          accuracy,
          textLength: text.length,
          textType: selectedLevel,
          timeSpent: timeSpentSeconds,
          errors: finalErrors,
          // These are used for stats/challenge context, but XP awarding should not wait on them.
          dailyAvgWpm: wpm,
          dailyAvgAcc: accuracy,
          sessionsCount: 1,
        };

        // Award session XP immediately (do not wait for network).
        const sessionXP = calculateSessionXP(sessionData);

        // Participation XP ramps with time spent to prevent micro-session farming.
        // (Keeps changes minimal; focus is on earned XP fairness.)
        const MIN_SESSION_XP = Math.min(15, Math.round(timeSpentSeconds * 0.75));
        const topUpXP = Math.max(MIN_SESSION_XP - sessionXP, 0);
        if (topUpXP > 0) {
          addXPMessage("Participation Reward", topUpXP, "participation");
        }

        const immediateXP = sessionXP + topUpXP;
        void addXP(immediateXP);

        // Record stats in the background (non-blocking)
        void recordSessionStats?.(wpm, accuracy, {
          textLength: text.length,
          timeSpent: timeSpentSeconds,
          mistakes: sessionMistakes,
          corrections: sessionCorrections,
          localDate: (() => {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          })(),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        });

        // Handle daily challenge in the background; award challenge XP when it completes.
        void handleDailyChallenge(sessionData)
          .then(({ completed, xp: challengeXP }) => {
            if (!completed || !challengeXP) return;
            addXPMessage("Daily Challenge Completed", challengeXP, "daily-challenge");
            void addXP(challengeXP);
          })
          .catch((challengeError) => {
            logger.session.warn("Daily challenge handling failed", {
              userId,
              challengeError,
            });
          });

        logger.session.info("Session completed for authenticated user", {
          userId,
          duration: performance.now() - sessionStartTime,
          wpm,
          accuracy,
          xpEarned: immediateXP,
        });
      } else {
        // Guest user handling
        logger.session.info("Guest session completed", {
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
        "Session completion failed",
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
    calculateSessionXP,
    recordSessionStats,
    handleDailyChallenge,
    addXP,
    addXPMessage,
    wpmHistory,
    userId, // Added for conditional execution
    state,
    metrics,
    rollback,
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

      setMetrics(() => ({
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
    const prevInput = userInputRef.current;

    if (state === "start") handleSessionStart();

    setUserInput(input);
    // Keep refs in sync immediately to avoid stale values on fast typing.
    userInputRef.current = input;

    setIsError(text.slice(0, input.length) !== input);

    // Uncorrected errors: count current mismatches (drops when user fixes).
    let mismatches = 0;
    const target = textRef.current;
    for (let i = 0; i < input.length; i += 1) {
      if (target[i] !== input[i]) mismatches += 1;
    }
    setTotalErrors(mismatches);

    // Cumulative mistakes/corrections: robust to paste and mid-string edits.
    // We approximate the edit region by finding common prefix/suffix.
    if (input.length !== prevInput.length || input !== prevInput) {
      const prevLen = prevInput.length;
      const nextLen = input.length;

      let prefix = 0;
      while (prefix < prevLen && prefix < nextLen && prevInput[prefix] === input[prefix]) {
        prefix += 1;
      }

      let suffix = 0;
      while (
        suffix < prevLen - prefix &&
        suffix < nextLen - prefix &&
        prevInput[prevLen - 1 - suffix] === input[nextLen - 1 - suffix]
      ) {
        suffix += 1;
      }

      const removed = Math.max(0, prevLen - (prefix + suffix));
      const added = Math.max(0, nextLen - (prefix + suffix));

      if (removed > 0 && nextLen < prevLen) {
        correctionsRef.current += removed;
        setTotalCorrections(correctionsRef.current);
      }

      if (added > 0) {
        const addedSegment = input.slice(prefix, nextLen - suffix);
        let addedMistakes = 0;
        for (let i = 0; i < addedSegment.length; i += 1) {
          if (target[prefix + i] !== addedSegment[i]) addedMistakes += 1;
        }
        if (addedMistakes > 0) {
          mistakesRef.current += addedMistakes;
          setTotalMistakes(mistakesRef.current);
        }
      }
    }

    // if (input.length >= text.length && state !== "end") { ... }
    if (input.length === text.length) {
      // Handle async session end properly
      const finalErrors = mismatches;
      const finalMistakes = mistakesRef.current;
      const finalCorrections = correctionsRef.current;
      handleSessionEnd({ finalErrors, mistakes: finalMistakes, corrections: finalCorrections }).catch((error) =>
        console.error("Failed to complete session:", error)
      );
    }

    // Reset idle timer on input
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (idleState.current.isIdle) handleIdleState(false);

    idleTimer.current = setTimeout(() => handleIdleState(true), 4000);
  };

  // Game reset
  const resetGame = useCallback(() => {
    selectNewText();
    setUserInput("");
    setIsError(false);
    setTotalErrors(0);
    setTotalMistakes(0);
    setTotalCorrections(0);
    mistakesRef.current = 0;
    correctionsRef.current = 0;
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

    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, [selectNewText]);

  return {
    userInput,
    isError,
    totalErrors,
    totalMistakes,
    totalCorrections,
    ...metrics,
    state,
    handleInputChange,
    resetGame,
    isIdle: idleState.current.isIdle,
    wpmHistory,
  };
}
