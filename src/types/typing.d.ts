// types/typing.d.ts
export type TextType = "SHORT" | "MEDIUM" | "LONG";
export type State = "start" | "running" | "end";
export type Mode = "course" | "game" | "practice" | "online";

export type GameState = {
userInput: string;
wpm: number;
  accuracy: number;
  totalErrors: number;
  state: 'start' | 'running' | 'end';
};

export type WpmHistoryPoint = {
  time: number;
  wpm: number;
  prevWpm: number;
};

export type TimePoint = { 
  time: number;   // Timestamp in milliseconds
  wpm: number;    // Words per minute at this time
  prevWpm: number // Previous recorded WPM
};
