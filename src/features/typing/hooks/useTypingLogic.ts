import { useState, useEffect, useRef, useCallback } from "react";
import { useWpmHistory } from "@/features/typing/hooks/useWpmHistory";
import { TextType, State } from "@/features/typing/types/typing";
import { useInterval } from "./useInterval";
import { getPreviousWpm } from "../utils/getPreviousWpm";
import { useLevel } from "@/features/level/hooks/useLevel";
import { MythicClaimMeta, SessionData } from "@/features/level/types/level";
import { logger } from "@/log/clientLogger";
import { computeConsistency } from "@/features/typing/utils/consistency";
import { segmentGraphemes } from "@/features/typing/utils/graphemes";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";


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
  selectedLevel: TextType,
  typingLanguage: TypingLanguage = "en"
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

  // consistency helper is provided by utils/consistency.ts

  // Derived values
  const textRef = useRef(text);
  const userInputRef = useRef(userInput);
  const sessionActive = state === "running" && !idleState.current.isIdle;

  const textSegmentsRef = useRef<ReturnType<typeof segmentGraphemes>>([]);
  const inputSegmentsRef = useRef<ReturnType<typeof segmentGraphemes>>([]);
  const mismatchCountRef = useRef(0);

  const mistakesRef = useRef(0);
  const correctionsRef = useRef(0);

  const {
    addXP,
    calculateSessionXP,
    addXPMessage,
    recordSessionStats,
    handleDailyChallenge,
    getBestWpm,
  } = levelContext;

  // Sync refs with current values
  useEffect(() => {
    textRef.current = text;
    // Cache grapheme segments for the current target text.
    textSegmentsRef.current = segmentGraphemes(text, typingLanguage);
  }, [text, typingLanguage]);

  useEffect(() => {
    userInputRef.current = userInput;
  }, [userInput]);

  const computeGraphemeStats = useCallback(() => {
    const inputNow = userInputRef.current;
    const segments = textSegmentsRef.current;

    // Segment user input too so comparisons are robust even when the same grapheme
    // can be represented with different UTF-16 code unit sequences (IME/combining marks).
    const inputSegments = segmentGraphemes(inputNow, typingLanguage);

    const typed = Math.min(inputSegments.length, segments.length);
    let correct = 0;
    let mismatches = 0;
    for (let i = 0; i < typed; i += 1) {
      if (inputSegments[i]!.segment === segments[i]!.segment) correct += 1;
      else mismatches += 1;
    }

    return { typed, correct, mismatches };
  }, [typingLanguage]);

  /** Calculate active time accounting for pauses */
  const getActiveTime = useCallback(() => {
    return startTime.current
      ? performance.now() - startTime.current - idleState.current.pausedDuration
      : 0;
  }, []);

  /** Calculate current WPM and accuracy metrics */
  const calculateMetrics = useCallback(() => {
    const { typed, correct } = computeGraphemeStats();

    const accuracy = +( (correct / Math.max(typed, 1)) * 100 ).toFixed(1);
    const activeTime = getActiveTime();
    const minutes = activeTime / 60000;
    const baseWpm = (correct / 5) / Math.max(minutes, 0.016667);

    const EARLY_SESSION_MS = 5000;
    const EARLY_WPM_CAP = 300;
    const HARD_WPM_CAP = 500;

    const cappedWpm = Math.min(
      Math.max(0, baseWpm),
      activeTime < EARLY_SESSION_MS ? EARLY_WPM_CAP : Infinity,
      HARD_WPM_CAP
    );

    const wpm = Math.round(cappedWpm);

    return { accuracy: Math.max(0, accuracy), wpm };
  }, [computeGraphemeStats, getActiveTime]);

  const roundTo2 = (value: number) => Math.round(value * 100) / 100;

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

      const { typed: typedSegments, correct: correctSegments } = computeGraphemeStats();
      const accuracy = +(
        (correctSegments / Math.max(typedSegments, 1)) * 100
      ).toFixed(1);

      const minutes = activeTime / 60000;
      const baseWpm = (correctSegments / 5) / Math.max(minutes, 0.016667);

      const EARLY_SESSION_MS = 5000;
      const EARLY_WPM_CAP = 300;
      const HARD_WPM_CAP = 500;

      const wpmPrecise = Math.min(
        Math.max(0, baseWpm),
        activeTime < EARLY_SESSION_MS ? EARLY_WPM_CAP : Infinity,
        HARD_WPM_CAP
      );

      const wpm = Math.round(wpmPrecise);
      const wpmForStorage = roundTo2(wpmPrecise);

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
          const key = `typing:lastResult:${typingLanguage}:${selectedLevel}`;
          window.localStorage.setItem(
            key,
            JSON.stringify({
              wpm: wpmForStorage,
              accuracy,
              ts: Date.now(),
              textLength: text.length,
            })
          );

          // Backward compatibility (English only).
          if (typingLanguage === "en") {
            window.localStorage.setItem(
              `typing:lastResult:${selectedLevel}`,
              JSON.stringify({
                wpm: wpmForStorage,
                accuracy,
                ts: Date.now(),
                textLength: text.length,
              })
            );
          }
        }
      } catch {
        // Ignore storage failures (private mode, quota, etc.)
      }

      commitSession(); // UI-related commit for all users

      // Only for authenticated users
      if (userId) {
        const timeSpentSeconds = Math.floor(activeTime / 1000);

        const { mismatches: computedErrors } = computeGraphemeStats();

        const finalErrors = Math.max(0, counts?.finalErrors ?? computedErrors);
        const sessionMistakes = Math.max(0, counts?.mistakes ?? mistakesRef.current);
        const sessionCorrections = Math.max(0, counts?.corrections ?? correctionsRef.current);

        // Compute consistency before sessionData so it can feed into XP calculation
        const currentSession = wpmHistory[wpmHistory.length - 1] ?? [];
        const rawConsistency = computeConsistency([currentSession]);
        const consistency = rawConsistency ?? undefined;

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
          // Enhanced XP fields
          corrections: sessionCorrections,
          ...(typeof consistency === "number" ? { consistency } : {}),
          prevBestWpm: getBestWpm?.() ?? 0,
        };

        // Award session XP immediately (do not wait for network).
        // Capture mythic/PB claim meta for optional server-side validation.
        let capturedMythicMeta: MythicClaimMeta | undefined;
        const sessionXP = calculateSessionXP(sessionData, (meta) => {
          capturedMythicMeta = meta;
        });

        // Participation XP ramps with time spent to prevent micro-session farming.
        // (Keeps changes minimal; focus is on earned XP fairness.)
        const MIN_SESSION_XP = Math.min(15, Math.round(timeSpentSeconds * 0.75));
        const topUpXP = Math.max(MIN_SESSION_XP - sessionXP, 0);
        if (topUpXP > 0) {
          addXPMessage("Participation Reward", topUpXP, "participation");
        }

        const immediateXP = sessionXP + topUpXP;
        void addXP(immediateXP, capturedMythicMeta);

        // Calculate per-session consistency (percentage 0-100) — already computed above
        // Record stats in the background (non-blocking)
        void recordSessionStats?.(wpmForStorage, accuracy, {
          textType: selectedLevel,
          textLength: text.length,
          timeSpent: timeSpentSeconds,
          mistakes: sessionMistakes,
          corrections: sessionCorrections,
          language: typingLanguage,
          localDate: (() => {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          })(),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          ...(typeof consistency === "number" ? { consistency } : {}),
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
          wpm: wpmForStorage,
          accuracy,
          xpEarned: immediateXP,
        });
      } else {
        // Guest user handling
        logger.session.info("Guest session completed", {
          wpm: wpmForStorage,
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
    computeGraphemeStats,
    typingLanguage,
    getBestWpm,
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
    const rawInput = e.target.value;
    const prevInput = userInputRef.current;
    const prevSegments = inputSegmentsRef.current;

    // Cap input to the target text length in *graphemes* (not UTF-16 code units).
    // This prevents overshooting the target (common with IME / combining sequences),
    // which previously blocked the exact `input.length === text.length` completion.
    const targetSegments = textSegmentsRef.current;
    const maxGraphemes = targetSegments.length;
    const rawSegments = segmentGraphemes(rawInput, typingLanguage);
    const nextInputSegments =
      maxGraphemes > 0 && rawSegments.length > maxGraphemes
        ? rawSegments.slice(0, maxGraphemes)
        : rawSegments;
    const typedGraphemes = Math.min(nextInputSegments.length, maxGraphemes);
    const input =
      maxGraphemes > 0 && rawSegments.length > maxGraphemes
        ? rawInput.slice(0, rawSegments[maxGraphemes - 1]!.end)
        : rawInput;

    if (state === "start") handleSessionStart();

    setUserInput(input);
    // Keep refs in sync immediately to avoid stale values on fast typing.
    userInputRef.current = input;

    // Uncorrected errors: keep a fast incremental path for common typing/backspace,
    // with a safe full recompute fallback for arbitrary mid-string edits/pastes.
    let mismatches = mismatchCountRef.current;
    if (input !== prevInput) {
      const prevTyped = Math.min(prevSegments.length, maxGraphemes);

      if (typedGraphemes >= prevTyped && input.startsWith(prevInput)) {
        for (let i = prevTyped; i < typedGraphemes; i += 1) {
          if (nextInputSegments[i]!.segment !== targetSegments[i]!.segment) mismatches += 1;
        }
      } else if (typedGraphemes < prevTyped && prevInput.startsWith(input)) {
        for (let i = typedGraphemes; i < prevTyped; i += 1) {
          if (prevSegments[i]!.segment !== targetSegments[i]!.segment) mismatches -= 1;
        }
      } else {
        mismatches = 0;
        for (let i = 0; i < typedGraphemes; i += 1) {
          if (nextInputSegments[i]!.segment !== targetSegments[i]!.segment) mismatches += 1;
        }
      }
    }

    mismatches = Math.max(0, mismatches);
    mismatchCountRef.current = mismatches;
    inputSegmentsRef.current = nextInputSegments;

    const target = textRef.current;
    setTotalErrors(mismatches);
    setIsError(mismatches > 0);

    // Cumulative mistakes/corrections: robust to paste and mid-string edits.
    // We approximate the edit region by finding common prefix/suffix.
    if (input !== prevInput) {
      const prevLen = prevInput.length;
      const nextLen = input.length;

      let prefix = 0;
      let suffix = 0;

      if (nextLen >= prevLen && input.startsWith(prevInput)) {
        // Fast path for common typing case: append at the end.
        prefix = prevLen;
      } else if (nextLen < prevLen && prevInput.startsWith(input)) {
        // Fast path for common correction case: backspace from the end.
        prefix = nextLen;
      } else {
        while (
          prefix < prevLen &&
          prefix < nextLen &&
          prevInput[prefix] === input[prefix]
        ) {
          prefix += 1;
        }

        while (
          suffix < prevLen - prefix &&
          suffix < nextLen - prefix &&
          prevInput[prevLen - 1 - suffix] === input[nextLen - 1 - suffix]
        ) {
          suffix += 1;
        }
      }

      const removed = Math.max(0, prevLen - (prefix + suffix));
      const added = Math.max(0, nextLen - (prefix + suffix));

      if (removed > 0 && nextLen < prevLen) {
        correctionsRef.current += removed;
        setTotalCorrections(correctionsRef.current);
      }

      if (added > 0) {
        const addedStart = prefix;
        const addedEnd = nextLen - suffix;
        let addedMistakes = 0;
        for (let i = addedStart; i < addedEnd; i += 1) {
          if (target[i] !== input[i]) addedMistakes += 1;
        }
        if (addedMistakes > 0) {
          mistakesRef.current += addedMistakes;
          setTotalMistakes(mistakesRef.current);
        }
      }
    }

    // Complete when the user has typed all target graphemes.
    // (Input is capped above, so this is stable and language-agnostic.)
    if (state !== "end" && maxGraphemes > 0 && typedGraphemes === maxGraphemes) {
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
    mismatchCountRef.current = 0;
    inputSegmentsRef.current = [];
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
