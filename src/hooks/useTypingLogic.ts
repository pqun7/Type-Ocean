import { useState, useEffect, useRef, useCallback } from "react";
import { useWpmHistory } from "./useWpmHistory";
import { TextType, State } from "@/types/typing";
import { useInterval } from "./useInterval";
import { getPreviousWpm } from "../utils/getPreviousWpm";
import { useLevel } from "@/contexts/hook/useLevel";
import { SessionData } from "@/types/level";
import {
  calculateNextLevelXP,
  getChallengeXP,
} from "@/contexts/utils/levelUtils";

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
  const { wpmHistory, startNewSession, addTempPoints, commitSession } =
    useWpmHistory();

  // Derived values
  const textRef = useRef(text);
  const userInputRef = useRef(userInput);
  const sessionActive = state === "running" && !idleState.current.isIdle;

  const {
    addXP,
    calculateSessionXP,
    addXPMessage,
    level,
    calculateDailyAverage,
    handleDailyChallenge,
  } = useLevel();

  // Sync refs with current values
  useEffect(() => {
    textRef.current = text;
    userInputRef.current = userInput;
  }, [text, userInput]);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("dailyStats")) {
      localStorage.setItem(
        "dailyStats",
        JSON.stringify({
          n: 0,
          avgWpm: 0,
          avgAcc: 0,
          newWpm: 0,
          newAcc: 0,
          prevAvgWpm: 0,
          prevAvgAcc: 0,
        })
      );
    }
  }, []);

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

    for (let i = 0; i < 100; i++) {
      const nextLevelXP = calculateNextLevelXP(i);
      console.log(`Level ${i}: XP required -> ${nextLevelXP}`);
    }
  }, [startNewSession, addTempPoints]);

  const handleSessionEnd = useCallback(() => {
    const activeTime = getActiveTime();
    const { wpm, accuracy } = calculateMetrics();

    const { dailyAvgWpm, dailyAvgAcc, sessionsCount } = calculateDailyAverage(
      wpm,
      accuracy
    );

    // Create session data object
    const sessionData: SessionData = {
      wpm,
      accuracy,
      textLength: text.length,
      textType: selectedLevel,
      timeSpent: Math.floor(activeTime / 1000),
      errors: totalErrors,
      dailyAvgWpm,
      dailyAvgAcc,
      sessionsCount,
    };

    setMetrics((prev) => ({
      ...prev,
      wpm,
      elapsedTime: Math.floor(activeTime / 1000),
    }));

    commitSession();
    setState("end");

    // Calculate XP first
    const baseXP = calculateSessionXP(sessionData);
    const bonusXP = getChallengeXP(level);
    const totalXP = baseXP + bonusXP;

    // Handle daily challenge - this will automatically update local storage
    const { completed, xp } = handleDailyChallenge(sessionData);

    // Add challenge XP if completed
    if (completed) {
      addXP(xp);
      addXPMessage("Daily Challenge Completed", xp, "daily-challenge");
    }

    // Add XP and participation message if earnedXP is less than 15
    if (totalXP < 15) {
      addXP(15);
      addXPMessage("Participation Reward", 15, "participation");
    } else {
      addXP(totalXP);
      // addXPMessage("Session Completed", totalXP, "level-up");
    }
  }, [
    getActiveTime,
    calculateMetrics,
    commitSession,
    addXP,
    selectedLevel,
    text.length,
    calculateSessionXP,
    calculateDailyAverage,
    handleDailyChallenge,
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

    if (input.length === text.length) handleSessionEnd();

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
