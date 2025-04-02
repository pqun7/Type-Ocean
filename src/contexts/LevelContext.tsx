// contexts/LevelContext.tsx
"use client";

import { createContext, useContext, useReducer } from "react";

const BASE_XP = 100;

type LevelState = {
  level: number;
  userXP: number;
  nextLevelXP: number;
};

type LevelAction = { type: "ADD_XP"; amount: number };

const LevelContext = createContext<{
  level: number;
  userXP: number;
  nextLevelXP: number;
  addXP: (amount: number) => void;
} | null>(null);

function levelReducer(state: LevelState, action: LevelAction): LevelState {
  switch (action.type) {
    case "ADD_XP":
      let newXP = state.userXP + action.amount;
      let currentLevel = state.level;
      let currentNextLevelXP = state.nextLevelXP;

      while (newXP >= currentNextLevelXP) {
        newXP -= currentNextLevelXP;
        currentLevel++;
        currentNextLevelXP = Math.round(BASE_XP * Math.pow(1.2, currentLevel - 1));
      }

      return {
        level: currentLevel,
        userXP: newXP,
        nextLevelXP: currentNextLevelXP,
      };
    default:
      return state;
  }
}

export function LevelProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(levelReducer, {
    level: 1,
    userXP: 0,
    nextLevelXP: BASE_XP,
  });

  const addXP = (amount: number) => dispatch({ type: "ADD_XP", amount });

  return (
    <LevelContext.Provider value={{ ...state, addXP }}>
      {children}
    </LevelContext.Provider>
  );
}

export function useLevel() {
  const context = useContext(LevelContext);
  if (!context) {
    throw new Error("useLevel must be used within a LevelProvider");
  }
  return context;
}