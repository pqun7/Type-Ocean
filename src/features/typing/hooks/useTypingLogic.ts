import { useState, useEffect, useRef, useCallback } from "react";
import { useWpmHistory } from "@/features/typing/hooks/useWpmHistory";
import { TextType, State } from "@/features/typing/types/typing";
import { useInterval } from "./useInterval";
import { getPreviousWpm } from "../utils/getPreviousWpm";
import { useLevel } from "@/features/level/hooks/useLevel";
import { MythicClaimMeta, SessionData } from "@/features/level/types/level";
import { logger } from "@/log/clientLogger";
import { computeConsistency } from "@/features/typing/utils/consistency";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import type { ValidatedTypingStats } from "@/components/TypingTest/TypingTest";
import {
  createEngineConfig,
  createInitialState,
  processInput,
  processResync,
} from "@/features/typing/core/typingEngine";
import type { EngineState, TypingMode } from "@/features/typing/core/typingTypes";


/**
 * Core typing test logic hook managing:
 * - User input handling and validation (delegated to the pure typingEngine)
 * - Real-time metrics calculation (WPM, accuracy, time)
 * - Session lifecycle management
 * - Idle state detection and pause handling
 * - Historical performance tracking
 *
 * All grapheme segmentation, mismatch tracking, and strict-mode cursor locking
 * live in `src/features/typing/core/typingEngine.ts`.  This hook owns only the
 * React state wrappers and side-effectful session logic (XP, stats, daily challenge).
 *
 * @param text - Target text for typing test
 * @param selectNewText - Function to generate new test text
 * @returns Object containing state, handlers, and metrics
 */
export default function useTypingLogic(
  text: string,
  selectNewText: (level?: TextType) => void,
  selectedLevel: TextType,
  typingLanguage: TypingLanguage = "en",
  options?: {
    /** Called on every validated keystroke with the clean (capped) input string,
     *  the number of graphemes typed, and whether the text is now complete.
     *  Use this in PvP to send INPUT_UPDATE / FINISH without a separate onChange. */
    onInputValidated?: (
      input: string,
      graphemesTyped: number,
      isComplete: boolean,
      stats: ValidatedTypingStats,
    ) => void;
    /** When true, skip XP / stats / daily-challenge recording at session end.
     *  Set this for PvP where the server owns all match results. */
    skipSessionTracking?: boolean;
    /**
     * Typing mode for this session.
     * - `"normal"` (default) — cursor advances freely, errors are tracked.
     * - `"strict"` — cursor locks at the first wrong grapheme; backspace required.
     */
    mode?: TypingMode;
  }
) {
  // ── React state ────────────────────────────────────────────────────────────
  const [state, setState] = useState<State>("start");
  /**
   * Mirror of `engineStateRef.current.input` — kept in React state so that
   * components re-render when the input value changes.
   */
  const [userInput, setUserInput] = useState("");
  /** Mirror of `engineStateRef.current.mismatches > 0` for React renders. */
  const [isError, setIsError] = useState(false);
  /** Mirror of `engineStateRef.current.mismatches` for stat display. */
  const [totalErrors, setTotalErrors] = useState(0);
  /** Mirror of `engineStateRef.current.totalMistakes` for stat display. */
  const [totalMistakes, setTotalMistakes] = useState(0);
  /** Mirror of `engineStateRef.current.totalCorrections` for stat display. */
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

  // ── Engine ────────────────────────────────────────────────────────────────
  /**
   * The pure engine state ref — always in sync with the last `processInput` /
   * `processResync` call.  Reading it is safe from any stable callback without
   * stale-closure risk.
   */
  const engineStateRef = useRef<EngineState>(createInitialState());

  /**
   * Stable engine config rebuilt whenever the target text or locale changes.
   * Rebuilding is O(n) on the text length (grapheme segmentation) so we keep
   * it in a ref and only recreate it when the inputs actually change.
   */
  const engineConfigRef = useRef(
    createEngineConfig(text, typingLanguage, options?.mode ?? "normal")
  );

  // Keep config ref in sync with text / locale / mode.
  const modeRef = useRef<TypingMode>(options?.mode ?? "normal");
  useEffect(() => {
    modeRef.current = options?.mode ?? "normal";
    engineConfigRef.current = createEngineConfig(text, typingLanguage, modeRef.current);
  }, [text, typingLanguage, options?.mode]);

  // ── Legacy refs (kept for WPM / session lifecycle helpers below) ──────────
  /**
   * Up-to-date copy of the current input string — safe to read in stable
   * callbacks without creating stale closures.  Mirrors `engineStateRef.current.input`.
   */
  const userInputRef = useRef(userInput);

  // ── Persistent references ─────────────────────────────────────────────────
  const startTime = useRef<number | null>(null);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  const idleState = useRef({
    isIdle: false,
    lastActiveWpm: 0,
    pausedDuration: 0,
    idleStart: null as number | null,
  });
  const sessionActive = state === "running" && !idleState.current.isIdle;

  // ── Historical data ───────────────────────────────────────────────────────
  const {
    wpmHistory,
    startNewSession,
    addTempPoints,
    commitSession,
    rollback,
  } = useWpmHistory();

  const {
    addXP,
    calculateSessionXP,
    addXPMessage,
    recordSessionStats,
    handleDailyChallenge,
    getBestWpm,
  } = levelContext;

  // Keep userInputRef in sync with state (stable read in callbacks).
  useEffect(() => {
    userInputRef.current = userInput;
  }, [userInput]);

  /**
   * Derive grapheme stats from the engine state ref directly — no segmentation
   * needed here because the engine already tracks typed/correct/mismatches.
   */
  const computeGraphemeStats = useCallback(() => {
    const eng = engineStateRef.current;
    const targetLen = engineConfigRef.current.targetSegments.length;
    const typed = Math.min(eng.inputSegments.length, targetLen);
    const mismatches = eng.mismatches;
    const correct = typed - mismatches;
    return { typed, correct, mismatches };
  }, []);

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

      // Only for authenticated users — skip entirely when session tracking is
      // disabled (e.g. PvP where the server owns all results / XP).
      if (userId && !options?.skipSessionTracking) {
        const timeSpentSeconds = Math.floor(activeTime / 1000);

        const { mismatches: computedErrors } = computeGraphemeStats();

        const finalErrors = Math.max(0, counts?.finalErrors ?? computedErrors);
        const sessionMistakes = Math.max(0, counts?.mistakes ?? engineStateRef.current.totalMistakes);
        const sessionCorrections = Math.max(0, counts?.corrections ?? engineStateRef.current.totalCorrections);

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
    options?.skipSessionTracking,
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

    if (state === "start") handleSessionStart();

    // Delegate ALL segment/cap/mismatch/strict logic to the pure engine.
    const nextEngineState = processInput(
      engineConfigRef.current,
      engineStateRef.current,
      rawInput
    );

    // Persist new engine state into the ref first so that computeGraphemeStats
    // (which reads from this ref) is immediately consistent.
    engineStateRef.current = nextEngineState;

    // Mirror relevent engine values into React state for re-renders.
    const { input, mismatches, totalMistakes: nextMistakes, totalCorrections: nextCorrections, isComplete } = nextEngineState;

    setUserInput(input);
    userInputRef.current = input;
    setTotalErrors(mismatches);
    setIsError(mismatches > 0);
    setTotalMistakes(nextMistakes);
    setTotalCorrections(nextCorrections);

    const typedGraphemes = nextEngineState.inputSegments.length;

    // Notify any external listener (e.g. PvP socket bridge) about each
    // validated keystroke AND the completion event.
    options?.onInputValidated?.(input, typedGraphemes, isComplete, {
      totalMistakes: nextMistakes,
      totalCorrections: nextCorrections,
      mismatches,
    });

    if (isComplete && state !== "end") {
      handleSessionEnd({
        finalErrors: mismatches,
        mistakes: nextMistakes,
        corrections: nextCorrections,
      }).catch((error) => console.error("Failed to complete session:", error));
    }

    // Reset idle timer on input
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (idleState.current.isIdle) handleIdleState(false);

    idleTimer.current = setTimeout(() => handleIdleState(true), 4000);
  };

  // Game reset
  const resetGame = useCallback(() => {
    selectNewText();
    engineStateRef.current = createInitialState();
    setUserInput("");
    setIsError(false);
    setTotalErrors(0);
    setTotalMistakes(0);
    setTotalCorrections(0);
    userInputRef.current = "";
    setState("start");
    setMetrics({ wpm: 0, accuracy: 100, elapsedTime: 0 });

    // Reset timing / idle references
    startTime.current = null;
    idleState.current = {
      isIdle: false,
      lastActiveWpm: 0,
      pausedDuration: 0,
      idleStart: null,
    };

    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, [selectNewText]);

  /**
   * Advance the in-progress input to a server-authoritative value.
   * Safe to call from a MATCH_STATE resync — never rewinds local state.
   * Delegates to the pure `processResync` engine function (invariant I6 upheld there).
   */
  const resyncInput = useCallback((serverInput: string) => {
    const nextEngineState = processResync(
      engineConfigRef.current,
      engineStateRef.current,
      serverInput
    );

    // processResync returns prevState unchanged when serverInput is not longer.
    if (nextEngineState === engineStateRef.current) return;

    engineStateRef.current = nextEngineState;
    const { input, mismatches } = nextEngineState;

    userInputRef.current = input;
    setUserInput(input);
    setTotalErrors(mismatches);
    setIsError(mismatches > 0);

    if (state === "start" && input.length > 0) {
      handleSessionStart();
    }
  }, [state, handleSessionStart]);

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
    resyncInput,
    isIdle: idleState.current.isIdle,
    wpmHistory,
  };
}
