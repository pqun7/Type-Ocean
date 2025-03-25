import { useRef, useEffect } from "react";
import useTextManager from "./useTextManager";
import useTypingLogic from "./useTypingLogic";
import useCaret from "./useCaret";

export default function useTypingGame(texts: string[]) {
  const { text, resetText } = useTextManager(texts);
  const {
    userInput,
    isError,
    wpm,
    accuracy,
    state,
    elapsedTime,
    handleInputChange,
    resetGame,
    isIdle,
    wpmHistory, 
    errorTimes,
  } = useTypingLogic(text, resetText);
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
    errorTimes,
  };
}
