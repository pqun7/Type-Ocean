import { useRef, useEffect } from "react";
import useTextManager from "@/features/typing/hooks/useTextManager";
import useTypingLogic from "@/features/typing/hooks/useTypingLogic";
import useCaret from "./useCaret";

import { getTypingDir, type TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import type { TypingMode } from "@/features/typing/core/typingTypes";

type Level = "SHORT" | "MEDIUM" | "LONG";

export default function useTypingGame(
  selectedLevel: Level,
  enabled: boolean = true,
  typingLanguage: TypingLanguage = "en",
  options?: {
    /** Provide a fixed text string; bypasses useTextManager selection. */
    externalText?: string;
    /** Forwarded to useTypingLogic — fires on every validated keystroke. */
    onInputValidated?: (input: string, graphemesTyped: number, isComplete: boolean) => void;
    /** Forwarded to useTypingLogic — skips XP/stats on session end. */
    skipSessionTracking?: boolean;
    /** Forwarded to useTypingLogic — "strict" locks cursor at first mismatch (PvP/MonkeyType). */
    mode?: TypingMode;
  }
) {
  const { text: managedText, resetText } = useTextManager(selectedLevel, "smart", typingLanguage);
  // When an external text is supplied (e.g. server-selected PvP text) skip
  // the text-manager and use that text directly; also noop the reset function.
  const text = options?.externalText !== undefined ? options.externalText : managedText;
  const selectText = options?.externalText !== undefined ? () => {} : resetText;

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
    resyncInput,
    isIdle,
    elapsedTime,
  } = useTypingLogic(text, selectText, selectedLevel, typingLanguage, {
    onInputValidated: options?.onInputValidated,
    skipSessionTracking: options?.skipSessionTracking,
    mode: options?.mode,
  });
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
    resyncInput,
    inputRef,
    textRefs,
    isIdle,
    elapsedTime,
    wpmHistory,
  };
}
