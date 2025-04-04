// types/typing.d.ts
export type Level = "SHORT" | "MEDIUM" | "LONG";

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

export type TextType = "SHORT" | "MEDIUM" | "LONG";
export type LevelState = {
  level: number;
  userXP: number;
  nextLevelXP: number;
};

export type XPMessage = {
  id: string;
  text: string;
};

export type LevelAction = { type: "ADD_XP"; amount: number };

export type LevelContextType = {
  level: number;
  userXP: number;
  nextLevelXP: number;
  addXP: (amount: number) => void;
  calculateSessionXP: (
    wpm: number,
    accuracy: number,
    textType: TextType
  ) => number;
  xpMessages: XPMessage[];
  addXPMessage: (text: string) => void;
};