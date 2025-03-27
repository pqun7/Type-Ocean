import { useEffect, useRef } from "react";

/**
 * Custom hook for managing intervals in React components
 * @param callback - Function to execute at each interval
 * @param delay - Interval duration in milliseconds (null to pause)
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<() => void>(null);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval
  useEffect(() => {
    const tick = () => savedCallback.current?.();
    if (delay !== null) {
      const id = setInterval(tick, delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}