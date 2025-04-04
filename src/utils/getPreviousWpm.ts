import { TimePoint } from "../types";

/**
 * Finds the closest WPM value from historical data
 * @param activeTime - Current session time in milliseconds
 * @param history - Array of historical WPM sessions
 * @returns Closest WPM value from previous session
 */
export function getPreviousWpm(activeTime: number, history: TimePoint[][]): number {
  if (history.length < 1) return 0;
  
  const previousSession = history[history.length - 1];
  const timeInSeconds = Math.floor(activeTime / 1000);
  
  return previousSession.reduce((closest, current) => {
    const currentDiff = Math.abs(Math.floor(current.time / 1000) - timeInSeconds);
    const closestDiff = Math.abs(Math.floor(closest.time / 1000) - timeInSeconds);
    return currentDiff < closestDiff ? current : closest;
  }, previousSession[0]).wpm;
}