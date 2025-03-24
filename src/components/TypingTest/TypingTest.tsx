"use client";
import { useEffect } from "react";
import TextDisplay from "./TextDisplay";
import TypingInput from "./TypingInput";
import Caret from "./Caret";
import useTypingGame from "../hooks/useTypingGame";


type TypingTestProps = {
  texts: string[];
  onStateChange: (state: "start" | "running" | "end") => void;
  onWpmChange: (wpm: number) => void;
  onAccuracyChange: (accuracy: number) => void;
  onIdleChange: (isIdle: boolean) => void;
  onElapsedTimeChange: (time: number) => void;
  onGameEnd?: (wpmHistory: { time: number; wpm: number }[], errorTimes: number[]) => void;
  fontSize?: string;
  caretHeight?: string;
  font?: string;
  className?: string;
  lineHeight?: string
};

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
  onGameEnd
  
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
  } = useTypingGame(texts);

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