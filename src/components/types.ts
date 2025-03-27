/**
 * Type definitions for typing test application
 */

export type Level = "SHORT" | "MEDIUM" | "LONG";
export type State = "start" | "running" | "end";
export type TimePoint = { 
  time: number;   // Timestamp in milliseconds
  wpm: number;    // Words per minute at this time
  prevWpm: number // Previous recorded WPM
};