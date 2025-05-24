// hooks/useTextManager.ts
"use client";

import { useState, useEffect } from "react";
import short from "@/features/typing/data/short.json";
import medium from "@/features/typing/data/medium.json";
import long from "@/features/typing/data/long.json";

type Level = "SHORT" | "MEDIUM" | "LONG";

export default function useTextManager(selectedLevel: Level) {
  const [text, setText] = useState<string>("");

  const getTextsByLevel = (level: Level) => {
    switch (level) {
      case "SHORT":
        return short;
      case "MEDIUM":
        return medium;
      case "LONG":
        return long;
      default:
        return medium;
    }
  };

  const getRandomText = (level: Level) => {
    const texts = getTextsByLevel(level);
    return texts[Math.floor(Math.random() * texts.length)].content;
  };

  const resetText = () => {
    const newText = getRandomText(selectedLevel);
    setText(newText);
  };

  useEffect(() => {
    resetText();
  }, [selectedLevel]);

  return { text, resetText };
}