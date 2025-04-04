import { useRef, useEffect } from "react";
import useTextManager from "./useTextManager";
import useTypingLogic from "./useTypingLogic";
import useCaret from "./useCaret";
import { useLevel } from "@/contexts/LevelContext";

type Level = "SHORT" | "MEDIUM" | "LONG";

export default function useTypingGame(selectedLevel: Level) {
  const { text, resetText } = useTextManager(selectedLevel);
  const {
    userInput,
    isError,
    totalErrors,
    wpm,
    accuracy,
    state,
    wpmHistory,
    handleInputChange,
    resetGame,
    isIdle,
    elapsedTime,
  } = useTypingLogic(text, resetText, selectedLevel);
  const { caretPosition, textRefs } = useCaret(userInput, text);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (state === "end" && e.key === "Tab") {
        e.preventDefault();
        resetGame();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, resetGame]);

  return {
    text,
    userInput,
    isError,
    totalErrors,
    wpm,
    accuracy,
    state,
    caretPosition,
    handleInputChange,
    resetGame,
    inputRef,
    textRefs,
    isIdle,
    elapsedTime,
    wpmHistory,
  };
}
