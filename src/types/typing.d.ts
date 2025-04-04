// types/typing.d.ts
export type Level = "SHORT" | "MEDIUM" | "LONG";

declare type GameState = {
  userInput: string;
  wpm: number;
  accuracy: number;
  totalErrors: number;
  state: 'start' | 'running' | 'end';
};

declare type WpmHistoryPoint = {
  time: number;
  wpm: number;
  prevWpm: number;
};

export type { GameState, WpmHistoryPoint };
