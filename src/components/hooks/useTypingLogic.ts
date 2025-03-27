import { useState, useEffect, useRef, useCallback } from "react";
import { useWpmHistory } from "./useWpmHistory";

type Level = "SHORT" | "MEDIUM" | "LONG";
type State = "start" | "running" | "end";
type TimePoint = { time: number; wpm: number; prevWpm: number };

export default function useTypingLogic(
  text: string,
  selectNewText: (level?: Level) => void
) {
  // State management
  const [state, setState] = useState<State>("start");
  const [userInput, setUserInput] = useState("");
  const [isError, setIsError] = useState(false);
  const [metrics, setMetrics] = useState({
    wpm: 0,
    accuracy: 100,
    elapsedTime: 0,
  });
  
  // Refs for persistent values
  const startTime = useRef<number | null>(null);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  const idleState = useRef({
    isIdle: false,
    lastActiveWpm: 0,
    pausedDuration: 0,
    idleStart: null as number | null,
  });
  
  // Historical data and session management
  const {
    wpmHistory,
    errorTimes,
    startNewSession,
    addTempPoints,
    commitSession,
    recordError,
  } = useWpmHistory();

  // Derived values and refs
  const textRef = useRef(text);
  const userInputRef = useRef(userInput);
  const sessionActive = state === "running" && !idleState.current.isIdle;

  // Update refs on changes
  useEffect(() => {
    textRef.current = text;
    userInputRef.current = userInput;
  }, [text, userInput]);

  // Time calculation utilities
  const getActiveTime = useCallback(() => {
    if (!startTime.current) return 0;
    return performance.now() - startTime.current - idleState.current.pausedDuration;
  }, []);

  const calculateMetrics = useCallback(() => {
    const currentInput = userInputRef.current;
    const currentText = textRef.current;
    
    // Accuracy calculation
    const correctChars = currentText
      .slice(0, currentInput.length)
      .split("")
      .filter((char, i) => char === currentInput[i]).length;
    const accuracy = +(correctChars / Math.max(currentInput.length, 1) * 100).toFixed(1);
    
    // WPM calculation
    const minutes = getActiveTime() / 60000;
    const wpm = Math.round(correctChars / 5 / Math.max(minutes, 0.016667));
    
    return { accuracy: Math.max(0, accuracy), wpm };
  }, [getActiveTime]);

  // Session management
  const handleSessionStart = useCallback(() => {
    setState("running");
    startTime.current = performance.now();
    startNewSession();
    addTempPoints([{ time: 0, wpm: 0, prevWpm: 0 }]);
  }, [startNewSession, addTempPoints]);

  const handleSessionEnd = useCallback(() => {
    const activeTime = getActiveTime();
    const { wpm } = calculateMetrics();
    
    setMetrics(prev => ({
      ...prev,
      wpm,
      elapsedTime: Math.floor(activeTime / 1000)
    }));
    
    commitSession();
    setState("end");
  }, [getActiveTime, calculateMetrics, commitSession]);

  // Idle state management
  const handleIdleState = useCallback((isIdle: boolean) => {
    if (isIdle) {
      idleState.current.idleStart = performance.now();
      idleState.current.lastActiveWpm = metrics.wpm;
    } else if (idleState.current.idleStart) {
      idleState.current.pausedDuration += performance.now() - idleState.current.idleStart;
      idleState.current.idleStart = null;
    }
    idleState.current.isIdle = isIdle;
    setMetrics(prev => ({ ...prev, wpm: isIdle ? idleState.current.lastActiveWpm : prev.wpm }));
  }, [metrics.wpm]);

  // Timed updates
  useInterval(() => {
    if (!sessionActive) return;
    
    const activeTime = getActiveTime();
    const { wpm, accuracy } = calculateMetrics();
    
    setMetrics(prev => ({
      wpm,
      accuracy,
      elapsedTime: Math.floor(activeTime / 1000)
    }));
    
    // Historical data update
    const prevWpm = getPreviousWpm(activeTime, wpmHistory);
    addTempPoints([{ time: activeTime, wpm, prevWpm }]);
  }, sessionActive ? 2000 : null);

  // Input handling
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    
    if (state === "start") handleSessionStart();
    
    setUserInput(input);
    setIsError(text.slice(0, input.length) !== input);
    
    if (input.length === text.length) {
      handleSessionEnd();
    }
    
    // Idle timer management
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (idleState.current.isIdle) handleIdleState(false);
    
    idleTimer.current = setTimeout(() => handleIdleState(true), 4000);
  };

  // Reset functionality
  const resetGame = useCallback(() => {
    selectNewText();
    setUserInput("");
    setIsError(false);
    setState("start");
    setMetrics({ wpm: 0, accuracy: 100, elapsedTime: 0 });
    
    // Reset ref values
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
    ...metrics,
    state,
    handleInputChange,
    resetGame,
    isIdle: idleState.current.isIdle,
    wpmHistory,
    errorTimes,
    recordError,
  };
}

// Helper hooks and utilities
function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<() => void>(null);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const tick = () => savedCallback.current?.();
    if (delay !== null) {
      const id = setInterval(tick, delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

function getPreviousWpm(activeTime: number, history: TimePoint[][]) {
  if (history.length < 1) return 0;
  
  const previousSession = history[history.length - 1];
  const timeInSeconds = Math.floor(activeTime / 1000);
  
  return previousSession.reduce((closest, current) => {
    const currentDiff = Math.abs(Math.floor(current.time / 1000) - timeInSeconds);
    const closestDiff = Math.abs(Math.floor(closest.time / 1000) - timeInSeconds);
    return currentDiff < closestDiff ? current : closest;
  }, previousSession[0]).wpm;
}