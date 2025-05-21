import { useContext } from "react";
import { LevelContext } from "@/contexts/LevelContext";
import { LevelContextType } from "@/features/level/types/level";

export const useLevel = (): LevelContextType => {
  const context = useContext(LevelContext);
  if (!context) {
    throw new Error('useLevel must be used within a LevelProvider');
  }
  return context;
};