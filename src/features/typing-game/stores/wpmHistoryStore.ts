// features/typing-game/stores/wpmHistoryStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type WpmHistoryState = {
  history: Array<Array<{ time: number; wpm: number; prevWpm: number }>>;
  tempSession: Array<{ time: number; wpm: number; prevWpm: number }>;
  startNewSession: () => void;
  addTempPoints: (points: Array<{ time: number; wpm: number; prevWpm: number }>) => void;
  commitSession: () => void;
};

export const useWpmHistoryStore = create<WpmHistoryState>()(
  persist(
    (set) => ({
      history: [],
      tempSession: [],
      
      startNewSession: () => set({ tempSession: [] }),
      
      addTempPoints: (points) => {
        set(state => ({
          tempSession: [...state.tempSession, ...points]
        }));
      },
      
      commitSession: () => {
        set(state => {
          const newHistory = [...state.history, state.tempSession].slice(-2);
          return {
            history: newHistory,
            tempSession: []
          };
        });
      }
    }),
    {
      name: 'wpm-history-storage',
      partialize: (state) => ({ history: state.history }),
    }
  )
);