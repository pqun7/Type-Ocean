"use client";

import { createContext, useContext, useReducer, useCallback, useMemo,useState } from "react";
import { v4 as uuidv4 } from 'uuid';


// Constants
const BASE_XP = 150;
const EXPONENTIAL_GROWTH_LEVEL = 30;
const LINEAR_GROWTH_INCREMENT = 2000;

// Types
type TextType = "SHORT" | "MEDIUM" | "LONG";
type LevelState = {
  level: number;
  userXP: number;
  nextLevelXP: number;
};

type XPMessage = {
  id: string;
  text: string;
};


type LevelAction = { type: "ADD_XP"; amount: number };

type LevelContextType = {
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


// Context
const LevelContext = createContext<LevelContextType | null>(null);

// XP Calculation Helper
export const calculateNextLevelXP = (level: number): number => {
  if (level <= EXPONENTIAL_GROWTH_LEVEL) {
    return Math.round(BASE_XP * Math.pow(1.08, level - 1));
  } else {
    const xpAt30 = BASE_XP * Math.pow(1.1, EXPONENTIAL_GROWTH_LEVEL - 0.8);
    return Math.round(xpAt30 + LINEAR_GROWTH_INCREMENT * (level - EXPONENTIAL_GROWTH_LEVEL));
  }
};

// Reducer
function levelReducer(state: LevelState, action: LevelAction): LevelState {
  switch (action.type) {
    case "ADD_XP":
      let newXP = state.userXP + action.amount;
      let currentLevel = state.level;
      let currentNextLevelXP = state.nextLevelXP;

      while (newXP >= currentNextLevelXP) {
        newXP -= currentNextLevelXP;
        currentLevel++;
        currentNextLevelXP = calculateNextLevelXP(currentLevel);
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

// Provider Component
export function LevelProvider({ children }: { children: React.ReactNode }) {
  const [xpMessages, setXPMessages] = useState<XPMessage[]>([]);

  const [state, dispatch] = useReducer(levelReducer, {
    level: 40,
    userXP: 0,
    nextLevelXP: BASE_XP,
  });


  const addXPMessage = useCallback((text: string) => {
    const id = uuidv4(); 
    setXPMessages(prev => [...prev, { id, text }]);
    setTimeout(() => {
      setXPMessages(prev => prev.filter(msg => msg.id !== id));
    }, 3000);
  }, []);

  const addXP = useCallback((amount: number) => {
    dispatch({ type: "ADD_XP", amount });
  }, []);

  const calculateSessionXP = useCallback((
    wpm: number,
    accuracy: number,
    textType: TextType
  ): number => {
    const { level, nextLevelXP } = state;
    
    const baseXPByType = {
      SHORT: 20,
      MEDIUM: 35,
      LONG: 50,
    };
  
    // Base XP with moderated level scaling
    const baseXP = baseXPByType[textType] * (1 + level * 0.02);
    
    // Speed bonus with adjusted base and scaling
    const speedBonus = Math.min(wpm * 0.4, 50) * (1 + level * 0.01);
    
    // Accuracy bonus with reduced base and scaling
    const accuracyBonus = (accuracy / 100) * 25 * (1 + level * 0.01);
    
    // NextLevel contribution to balance progression
    const nextLevelContribution = nextLevelXP * 0.015;
    
    // Level multiplier with controlled growth
    const levelMultiplier = Math.min(1 + level * 0.02, 1.5);
    
    // Calculate total XP
    let totalXP = (baseXP + speedBonus + accuracyBonus + nextLevelContribution) * levelMultiplier;
    
    // Additive special bonuses for balanced rewards
    let specialMultiplier = 1.0;
    if (accuracy === 100) specialMultiplier += 0.1;       // +10% for perfect accuracy
    if (wpm > 100) specialMultiplier += 0.1;             // +10% for WPM >100
    else if (wpm > 80) specialMultiplier += 0.05;        // +5% for WPM >80
  
    totalXP *= specialMultiplier;
    
    return Math.round(totalXP);
  }, [state]);

  const value = useMemo(() => ({
    ...state,
    addXP,
    calculateSessionXP,
    xpMessages,
    addXPMessage,
  }), [state, addXP, calculateSessionXP, xpMessages, addXPMessage]);

 

  return (
    <LevelContext.Provider value={value}>
      {children}
    </LevelContext.Provider>
  );
}

// Custom Hook
export function useLevel() {
  const context = useContext(LevelContext);
  if (!context) {
    throw new Error("useLevel must be used within a LevelProvider");
  }
  return context;
}