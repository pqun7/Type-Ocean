import { useRef, useEffect } from "react";
import useTextManager from "@/features/typing/hooks/useTextManager";
import useTypingLogic from "@/features/typing/hooks/useTypingLogic";
import useCaret from "./useCaret";

type Level = "SHORT" | "MEDIUM" | "LONG";

export default function useTypingGame(selectedLevel: Level, enabled: boolean = true) {
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
    if (!enabled) return;
    inputRef.current?.focus();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (state === "end" && e.key === "Tab") {
        e.preventDefault();
        resetGame();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, state, resetGame]);

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
