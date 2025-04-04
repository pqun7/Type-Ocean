// features/typing-game/stores/progressStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ProgressState = {
  level: number;
  userXP: number;
  nextLevelXP: number;
  xpMessages: Array<{ id: string; text: string }>;
  addXP: (amount: number) => void;
  addXPMessage: (text: string) => void;
  calculateSessionXP: (wpm: number, accuracy: number, textType: Level) => number;
};

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      level: 1,
      userXP: 0,
      nextLevelXP: 150,
      xpMessages: [],
      
      addXP: (amount) => {
        let newXP = get().userXP + amount;
        let currentLevel = get().level;
        let currentNextLevelXP = get().nextLevelXP;

        while (newXP >= currentNextLevelXP) {
          newXP -= currentNextLevelXP;
          currentLevel++;
          currentNextLevelXP = calculateNextLevelXP(currentLevel);
        }

        set({ 
          level: currentLevel,
          userXP: newXP,
          nextLevelXP: currentNextLevelXP
        });
      },

      addXPMessage: (text) => {
        const id = Date.now().toString();
        set(state => ({
          xpMessages: [...state.xpMessages, { id, text }]
        }));
        setTimeout(() => {
          set(state => ({
            xpMessages: state.xpMessages.filter(msg => msg.id !== id)
          }));
        }, 3000);
      },

      calculateSessionXP: (wpm, accuracy, textType) => {
        // ... XP calculation logic
      }
    }),
    {
      name: 'progress-storage',
      partialize: (state) => ({ 
        level: state.level,
        userXP: state.userXP,
        nextLevelXP: state.nextLevelXP
      }),
    }
  )
);