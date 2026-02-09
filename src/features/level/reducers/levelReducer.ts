// levelReducer.ts
import { LevelState, LevelAction } from "@/features/level/types/level";
import { calculateNextLevelXP } from "@/features/level/utils/xpMath";

/**
 * Reducer for managing level progression and achievements
 * @param state - Current level state
 * @param action - Dispatched action
 * @returns Updated level state
 */
export const levelReducer = (state: LevelState, action: LevelAction): LevelState => {
  switch (action.type) {
    case "ADD_XP": {
      const { userXP: currentXP, level: currentLevel } = state;
      let totalXP = currentXP + action.amount;
      let nextLevel = currentLevel;
      
      // Calculate level progression
      while (totalXP >= calculateNextLevelXP(nextLevel)) {
        totalXP -= calculateNextLevelXP(nextLevel);
        nextLevel++;
      }
      
      return {
        ...state,
        level: nextLevel,
        userXP: totalXP,
        nextLevelXP: calculateNextLevelXP(nextLevel),
      };
    }
    
    case 'UNLOCK_ACHIEVEMENT': {
      const exists = state.achievements.some(a => a.id === action.achievement.id);
      return {
        ...state,
        achievements: exists
          ? state.achievements.map(a => 
              a.id === action.achievement.id ? { ...a, unlocked: true } : a
            )
          : [...state.achievements, { ...action.achievement, unlocked: true }]
      };
    }
    
    case 'UPDATE_ACHIEVEMENT': {
      const exists = state.achievements.some(a => a.id === action.achievement.id);
      return {
        ...state,
        achievements: exists
          ? state.achievements.map(a => 
              a.id === action.achievement.id ? { ...a, progress: action.achievement.progress } : a
            )
          : [...state.achievements, { ...action.achievement, unlocked: false }]
      };
    }
    
    default:
      return state;
  }
};