import { useRef, useEffect } from "react";
import useTextManager from "@/features/typing/hooks/useTextManager";
import useTypingLogic from "@/features/typing/hooks/useTypingLogic";
import useCaret from "./useCaret";

import { getTypingDir, type TypingLanguage } from "@/features/typing/i18n/typingLanguages";

type Level = "SHORT" | "MEDIUM" | "LONG";

export default function useTypingGame(
  selectedLevel: Level,
  enabled: boolean = true,
  typingLanguage: TypingLanguage = "en"
) {
  const { text, resetText } = useTextManager(selectedLevel, "smart", typingLanguage);
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
  } = useTypingLogic(text, resetText, selectedLevel, typingLanguage);
  const dir = getTypingDir(typingLanguage);
  const { caretPosition, textRefs } = useCaret(userInput, text, dir);

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
