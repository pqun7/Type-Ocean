// features/typing-game/stores/gameStore.ts
import { create } from "zustand";
import { Level, WpmHistoryPoint } from "../../../types/typing";

type GameState = {
  // State
  selectedLevel: Level;
  gameState: "start" | "running" | "end";
  textKey: number;
  currentWpm: number;
  currentAccuracy: number;
  isIdle: boolean;
  currentTime: number;
  wpmHistory: WpmHistoryPoint[][];

  currentErrors: number;
  userInput: string;
  wpm: number;
  accuracy: number;
  totalErrors: number;
  state: "start" | "running" | "end";
  // Actions

  actions: {
    setUserInput: (input: string) => void;
    setMetrics: (wpm: number, accuracy: number) => void;
    setGameState: (state: GameState["state"]) => void;
    resetGame: () => void;
  };

  handleLevelSelect: (level: Level) => void;
  resetGame: () => void;
};

export const useGameStore = create<GameState>((set) => ({
  selectedLevel: "SHORT",
  gameState: "start",
  textKey: 0,
  currentWpm: 0,
  currentAccuracy: 100,
  isIdle: false,
  currentTime: 0,
  wpmHistory: [],
  currentErrors: 0,
  handleLevelSelect: (level) => set((state) => ({
    selectedLevel: level,
    textKey: state.textKey + 1,
    gameState: 'start'
  })),
  resetGame: () => set((state) => ({
    textKey: state.textKey + 1,
    gameState: 'start'
  })),
  userInput: "",
  wpm: 0,
  accuracy: 100,
  totalErrors: 0,
  state: "start",
  actions: {
    setUserInput: (input) => set({ userInput: input }),
    setMetrics: (wpm, accuracy) => set({ wpm, accuracy }),
    setGameState: (state) => set({ state }),
    resetGame: () =>
      set({
        userInput: "",
        wpm: 0,
        accuracy: 100,
        totalErrors: 0,
        state: "start",
      }),
  },
}));
