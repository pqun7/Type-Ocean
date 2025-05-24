"use client";

import { createContext } from "react";
import { LevelContextType } from "../types/level";

export const LevelContext = createContext<LevelContextType | null>(null);