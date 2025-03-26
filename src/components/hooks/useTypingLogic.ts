import { useState, useEffect, useRef } from "react";
import { useWpmHistory } from "./useWpmHistory";

type Level = "SHORT" | "MEDIUM" | "LONG";
type State = "start" | "running" | "end";

export default function useTypingLogic(
  text: string,
  selectNewText: (level?: Level) => void
) {
  // Basic application states
  const [userInput, setUserInput] = useState<string>("");
  const [isError, setIsError] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [wpm, setWpm] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(100);
  const [state, setState] = useState<State>("start");
  const [isIdle, setIsIdle] = useState<boolean>(false);
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // Refs for managing state without causing re-renders
  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  const lastActiveWpm = useRef(wpm);
  const pausedDurationRef = useRef<number>(0);
  const idleStartTimeRef = useRef<number | null>(null);
  const userInputRef = useRef(userInput);
  const textRef = useRef(text);
  const startTimeRef = useRef(startTime);

  const { wpmHistory, errorTimes, addWpmPoint, recordError, resetHistory } =
    useWpmHistory();

  // Sync refs with the latest values
  useEffect(() => {
    userInputRef.current = userInput;
    textRef.current = text;
    startTimeRef.current = startTime;
  }, [userInput, text, startTime]);

  // Manage elapsed time, accounting for idle periods
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
      updateElapsedTime(); // Immediate update on start
      intervalId = setInterval(updateElapsedTime, 1000);
    }

    return () => clearInterval(intervalId);
  }, [state, isIdle]);

  // Calculate WPM and accuracy every 3 seconds
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (state === "running" && !isIdle) {
      intervalId = setInterval(() => {
        if (!startTimeRef.current) return;

        const currentInput = userInputRef.current;
        const currentText = textRef.current;

        // Calculate accuracy
        const correctChars = currentText
          .slice(0, currentInput.length)
          .split("")
          .filter((char, i) => char === currentInput[i]).length;
        const newAccuracy = +Math.max(
          0,
          (correctChars / Math.max(currentInput.length, 1)) * 100
        ).toFixed(1);
        setAccuracy(newAccuracy);

        // Calculate WPM
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

        // getting the previous wpm value for the chart results
        const prevWpm =
          wpmHistory.length > 0 ? wpmHistory[wpmHistory.length - 1].wpm : 0;
          addWpmPoint(activeTime, newWpm, prevWpm); // استخدام activeTime المحسوب مسبقًا
        }, 3000);
    }

    return () => intervalId && clearInterval(intervalId);
  }, [state, isIdle, wpm]);

  // Handle user input
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;

    // Start the timer on the first input
    if (state === "start") {
      setState("running");
      setStartTime(performance.now());
      setElapsedTime(0);
    }

    setUserInput(input);
    setIsError(text.slice(0, input.length) !== input);

    // Check if the text is completed
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

    // Manage idle periods
    if (isIdle) {
      if (idleStartTimeRef.current) {
        pausedDurationRef.current +=
          performance.now() - idleStartTimeRef.current;
        idleStartTimeRef.current = null;
      }
      setIsIdle(false);
    }

    // Reset idle timer
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      // lastActiveWpm.current = wpm;

      idleStartTimeRef.current = performance.now();
      setIsIdle(true);
    }, 4000);

    // // Record errors
    // if (isError) {
    //   recordError(Date.now() - startTimeRef.current!);
    // }
  };

  // Freeze WPM during idle periods
  useEffect(() => {
    if (isIdle) setWpm(lastActiveWpm.current);
  }, [isIdle]);

  // Reset the game
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
    resetHistory(); // تصحيح الاستدعاء هنا
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
