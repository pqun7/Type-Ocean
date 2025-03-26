"use client";
import { useEffect } from "react";
import TextDisplay from "./TextDisplay";
import TypingInput from "./TypingInput";
import Caret from "./Caret";
import useTypingGame from "../hooks/useTypingGame";

interface TypingTestProps {
  texts: string[];
  fontSize?: string;
  lineHeight?: string;
  font?: string;
  caretHeight?: string;
  className?: string;
  onStateChange: (state: "start" | "running" | "end") => void;
  onWpmChange?: (wpm: number) => void;
  onAccuracyChange?: (accuracy: number) => void;
  onIdleChange?: (isIdle: boolean) => void;
  onElapsedTimeChange?: (time: number) => void;
  onWpmHistoryChange: (history: Array<{ time: number; wpm: number; prevWpm: number }[]>) => void;

}

export default function TypingTest({
  texts,
  fontSize = "text-xl",
  lineHeight = "leading-8",
  font = "font-mono",
  caretHeight = "h-6",
  className,
  onStateChange,
  onWpmChange,
  onAccuracyChange,
  onIdleChange,
  onElapsedTimeChange,
  onWpmHistoryChange
  
}: TypingTestProps) {
  const {
    text,
    userInput,
    isError,
    wpm,
    accuracy,
    state,
    caretPosition,
    handleInputChange,
    inputRef,
    textRefs,
    isIdle,
    elapsedTime,
    wpmHistory
  } = useTypingGame(texts);

  useEffect(() => {
    onWpmHistoryChange?.(wpmHistory);
  }, [wpmHistory, onWpmHistoryChange]);

  useEffect(() => {
    onStateChange(state);
  }, [state, onStateChange]);

  useEffect(() => {
    onWpmChange?.(wpm);
  }, [wpm, onWpmChange]);

  useEffect(() => {
    onAccuracyChange?.(accuracy);
  }, [accuracy, onAccuracyChange]);

  useEffect(() => {
    onIdleChange?.(isIdle);
  }, [isIdle, onIdleChange]);

  useEffect(() => {
    onElapsedTimeChange?.(elapsedTime);
  }, [elapsedTime, onElapsedTimeChange]);

  return (
    <div className={`relative w-full h-full rounded-md p-4 ${className}`}>
      <TextDisplay
        text={text}
        userInput={userInput}
        isError={isError}
        textRefs={textRefs}
        fontSize={fontSize}
        lineHeight={lineHeight}
        font={font}
      />
      <Caret caretPosition={caretPosition} caretHeight={caretHeight} />
      <TypingInput
        inputRef={inputRef}
        userInput={userInput}
        handleInputChange={handleInputChange}
      />
    </div>
  );
}