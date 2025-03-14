import { useRef, useEffect } from "react";
import useTextManager from "./useTextManager";
import useTypingLogic from "./useTypingLogic";
import useCaret from "./useCaret";

export default function useTypingGame(texts: string[]) {
  const { text, resetText } = useTextManager(texts);
  const { userInput, isError, wpm, accuracy, handleInputChange, resetGame } = useTypingLogic(text, resetText);
  const { caretPosition, textRefs } = useCaret(userInput, text);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return {
    text,
    userInput,
    isError,
    wpm,
    accuracy,
    caretPosition,
    handleInputChange,
    resetGame,
    inputRef,
    textRefs,
  };
}