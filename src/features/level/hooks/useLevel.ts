// useLevel.ts
"use client";

import { useContext } from "react";
import { LevelContext } from "@/features/level/context/LevelContext";
import { LevelContextType } from "@/features/level/types/level";

export const useLevel = (): LevelContextType => {
  const context = useContext(LevelContext);
  if (!context) {
    throw new Error('useLevel must be used within a LevelProvider');
  }
  return context;
};