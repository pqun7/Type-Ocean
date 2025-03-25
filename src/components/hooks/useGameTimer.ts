import { useState, useRef, useEffect } from 'react';

export function useGameTimer(isRunning: boolean, isIdle: boolean) {
  const [startTime, setStartTime] = useState<number | null>(null);
  const pausedDurationRef = useRef<number>(0);
  const idleStartTimeRef = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (isRunning && !isIdle && startTime) {
      intervalId = setInterval(() => {
        const activeTime = performance.now() - startTime - pausedDurationRef.current;
        setElapsedTime(Math.floor(activeTime / 1000));
      }, 1000);
    }
    return () => clearInterval(intervalId);
  }, [isRunning, isIdle, startTime]);

  useEffect(() => {
    if (isIdle && isRunning) {
      idleStartTimeRef.current = performance.now();
    } else if (!isIdle && isRunning && idleStartTimeRef.current) {
      pausedDurationRef.current += performance.now() - idleStartTimeRef.current;
      idleStartTimeRef.current = null;
    }
  }, [isIdle, isRunning]);

  const getActiveTime = (): number => {
    if (!startTime) return 0;
    const now = performance.now();
    const activeTime = now - startTime - pausedDurationRef.current;
    return activeTime;
  };

  const resetTimer = () => {
    setStartTime(null);
    pausedDurationRef.current = 0;
    idleStartTimeRef.current = null;
    setElapsedTime(0);
  };

  return { startTime, setStartTime, elapsedTime, getActiveTime, resetTimer };
}