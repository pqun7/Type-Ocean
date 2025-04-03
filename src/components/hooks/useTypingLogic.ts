import { useState, useEffect, useRef, useCallback } from "react";
import { useWpmHistory } from "./useWpmHistory";
import { Level, State, TimePoint } from "../types";
import { useInterval } from "./useInterval";
import { getPreviousWpm } from "../utils/getPreviousWpm";
import { useLevel } from "@/contexts/LevelContext";

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
  selectNewText: (level?: Level) => void,
  selectedLevel: Level
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

  const { addXP, calculateSessionXP, addXPMessage } = useLevel();

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

  const handleSessionEnd = useCallback(() => {
    const activeTime = getActiveTime();
    const { wpm, accuracy } = calculateMetrics();

    setMetrics((prev) => ({
      ...prev,
      wpm,
      elapsedTime: Math.floor(activeTime / 1000),
    }));

    commitSession();
    setState("end");

    if (
      (wpm >= 35 && selectedLevel === "SHORT") ||
      (wpm >= 25 && selectedLevel === "MEDIUM") ||
      (wpm >= 15 && selectedLevel === "LONG")
    ) {
      const earnedXP = calculateSessionXP(wpm, accuracy, selectedLevel);
      addXP(earnedXP);

      // Add XP message
      addXPMessage(`${earnedXP} XP from ${selectedLevel.toLowerCase()} text`);

      // Add accuracy bonus message
      if (accuracy === 100) {
        addXPMessage(`Accuracy Bonus: ${Math.round(earnedXP * 0.1)} XP`);
      }

      // Add speed bonus message
      if (wpm > 100) {
        addXPMessage(`Speed Bonus: ${Math.round(earnedXP * 0.1)} XP`);
      }
    } else {
      addXP(15);
      addXPMessage("15 XP for participation");
    }
  }, [getActiveTime, calculateMetrics, commitSession, addXP, selectedLevel, addXPMessage]);

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
