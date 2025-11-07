// useSessionXP.ts
"use client";

import { useReducer, useCallback } from "react";
import { levelReducer } from "../reducers/levelReducer";
import { calculateSessionXP } from "../utils/xpCalculations";
import { calculateNextLevelXP } from "../utils/xpMath";
import { XPMessageType } from "../types/level";

type Session = Parameters<typeof calculateSessionXP>[0];

/**
 * Manages XP calculations and level progression logic
 * @param userId - Current user identifier
 * @param addXPMessage - Callback for XP notification display
 * @returns XP state and calculation methods
 */
export const useSessionXP = (userId?: string, addXPMessage?: (text: string, value: number, messageType: XPMessageType) => void) => {
  // Level state management with reducer
  const [state, dispatch] = useReducer(levelReducer, {
    level: 1,
    userXP: 0,
    achievements: [],
    nextLevelXP: calculateNextLevelXP(1),
  });

  const addXP = useCallback(
    (amount: number) => {
      if (amount <= 0 || !userId) return;

      dispatch({ type: "ADD_XP", amount });

      if (addXPMessage) {
        addXPMessage("XP Added", amount, "base");
      }
    },
    [addXPMessage, userId]
  );

  // Memoized XP calculation with side effects
  const enhancedCalculateXP = useCallback(
    (session: Session) => calculateSessionXP(session, state, userId, addXPMessage, dispatch),
    [state, userId, addXPMessage]
  );

  return { state, calculateSessionXP: enhancedCalculateXP, addXP };
};