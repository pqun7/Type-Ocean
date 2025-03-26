import { useState, useEffect, useRef } from "react";
import { useWpmHistory } from "./useWpmHistory";

type Level = "SHORT" | "MEDIUM" | "LONG";
type State = "start" | "running" | "end";

export default function useTypingLogic(
  text: string,
  selectNewText: (level?: Level) => void
) {
  const [userInput, setUserInput] = useState<string>("");
  const [isError, setIsError] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [wpm, setWpm] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(100);
  const [state, setState] = useState<State>("start");
  const [isIdle, setIsIdle] = useState<boolean>(false);
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  const lastActiveWpm = useRef(wpm);
  const pausedDurationRef = useRef<number>(0);
  const idleStartTimeRef = useRef<number | null>(null);
  const userInputRef = useRef(userInput);
  const textRef = useRef(text);
  const startTimeRef = useRef(startTime);

  const { wpmHistory, errorTimes, addWpmPoint, recordError, resetHistory, startNewSession } =
    useWpmHistory();

  useEffect(() => {
    userInputRef.current = userInput;
    textRef.current = text;
    startTimeRef.current = startTime;
  }, [userInput, text, startTime]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const updateElapsedTime = () => {
      if (state === "running" && !isIdle && startTimeRef.current) {
        const activeTime =
          performance.now() - startTimeRef.current - pausedDurationRef.current;
        setElapsedTime(Math.floor(activeTime / 1000));
      }
    };

    if (state === "running" && !isIdle) {
      updateElapsedTime();
      intervalId = setInterval(updateElapsedTime, 1000);
    }

    return () => clearInterval(intervalId);
  }, [state, isIdle]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (state === "running" && !isIdle) {
      intervalId = setInterval(() => {
        if (!startTimeRef.current) return;

        const currentInput = userInputRef.current;
        const currentText = textRef.current;

        const correctChars = currentText
          .slice(0, currentInput.length)
          .split("")
          .filter((char, i) => char === currentInput[i]).length;
        const newAccuracy = +Math.max(
          0,
          (correctChars / Math.max(currentInput.length, 1)) * 100
        ).toFixed(1);
        setAccuracy(newAccuracy);

        const activeTime =
          performance.now() - startTimeRef.current - pausedDurationRef.current;
        const minutes = activeTime / 60000;
        const newWpm = Math.round(
          correctChars / 5 / Math.max(minutes, 0.016667)
        );

        if (newWpm !== wpm) {
          setWpm(newWpm);
          lastActiveWpm.current = newWpm;
        }

        // حساب prevWpm من الجلسة السابقة
        let prevWpm = 0;
        if (wpmHistory.length > 1) {
          const previousSession = wpmHistory[wpmHistory.length - 2];
          const timeInSeconds = Math.floor(activeTime / 1000);
          const prevPoint = previousSession.find(p => Math.floor(p.time / 1000) === timeInSeconds);
          prevWpm = prevPoint ? prevPoint.wpm : previousSession[previousSession.length - 1]?.wpm || 0;
        }

        addWpmPoint(activeTime, newWpm, prevWpm);
      }, 2000);
    }

    return () => intervalId && clearInterval(intervalId);
  }, [state, isIdle, wpm, wpmHistory]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;

    if (state === "start") {
      setState("running");
      setStartTime(performance.now());
      setElapsedTime(0);
      startNewSession();
      addWpmPoint(0, 0, 0); // نقطة البداية عند 0
    }

    setUserInput(input);
    setIsError(text.slice(0, input.length) !== input);

    if (input.length === text.length) {
      if (!startTimeRef.current) return;

      const correctChars = text
        .split("")
        .reduce((acc, char, i) => acc + (input[i] === char ? 1 : 0), 0);
      const activeTime =
        performance.now() - startTimeRef.current - pausedDurationRef.current;
      const finalWpm = Math.round(correctChars / 5 / (activeTime / 60000));

      setWpm(finalWpm);
      setElapsedTime(Math.floor(activeTime / 1000));
      setState("end");
    }

    if (isIdle) {
      if (idleStartTimeRef.current) {
        pausedDurationRef.current +=
          performance.now() - idleStartTimeRef.current;
        idleStartTimeRef.current = null;
      }
      setIsIdle(false);
    }

    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      idleStartTimeRef.current = performance.now();
      setIsIdle(true);
    }, 4000);
  };

  useEffect(() => {
    if (isIdle) setWpm(lastActiveWpm.current);
  }, [isIdle]);

  const resetGame = () => {
    selectNewText();
    setUserInput("");
    setIsError(false);
    setStartTime(null);
    setWpm(0);
    setAccuracy(100);
    setState("start");
    setElapsedTime(0);
    pausedDurationRef.current = 0;
    idleStartTimeRef.current = null;
    setIsIdle(false);
    lastActiveWpm.current = 0;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    // لا نستدعي resetHistory للاحتفاظ بالجلسات السابقة
  };

  return {
    userInput,
    isError,
    wpm,
    accuracy,
    state,
    handleInputChange,
    resetGame,
    isIdle,
    elapsedTime,
    wpmHistory,
    errorTimes,
    recordError,
    resetHistory,
  };
}