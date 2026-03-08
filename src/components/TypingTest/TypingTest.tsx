"use client";
import { useEffect } from "react";
import TextDisplay from "./TextDisplay";
import TypingInput from "./TypingInput";
import Caret from "./Caret";
import useTypingGame from "../../features/typing/hooks/useTypingGame";
import { useLevel } from "@/features/level/hooks/useLevel";
import { Skeleton } from "@/components/ui/skeleton";
import { getTypingDir, getTypingLocale, type TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import {
  buildKeyboardPerformanceData,
  type KeyboardPerformanceData,
} from "@/components/TypingTest/utils/keyboardPerformance";

interface TypingTestProps {
  texts: string[];
  fontSize?: string;
  lineHeight?: string;
  font?: string;
  caretHeight?: string;
  className?: string;
  optimizePerformance?: boolean;
  selectedLevel: "SHORT" | "MEDIUM" | "LONG";
  typingLanguage?: TypingLanguage;
  onStateChange: (state: "start" | "running" | "end") => void;
  onWpmChange?: (wpm: number) => void;
  onAccuracyChange?: (accuracy: number) => void;
  onIdleChange?: (isIdle: boolean) => void;
  onElapsedTimeChange?: (time: number) => void;
  onWpmHistoryChange: (history: Array<{ time: number; wpm: number; prevWpm: number }[]>) => void;
  onErrorsChange?: (errors: number) => void;
  onKeyboardPerformanceChange?: (data: KeyboardPerformanceData) => void;
}

export default function TypingTest({
  fontSize = "text-xl",
  lineHeight = "leading-8",
  font = "font-mono",
  caretHeight = "h-6",
  className,
  optimizePerformance = false,
  onStateChange,
  onWpmChange,
  onAccuracyChange,
  onIdleChange,
  onElapsedTimeChange,
  onWpmHistoryChange,
  onErrorsChange,
  onKeyboardPerformanceChange,
  selectedLevel,
  typingLanguage = "en",
}: TypingTestProps) {
  const level = useLevel();
  const isBootstrapping = !!level.isLoadingSession;

  const dir = getTypingDir(typingLanguage);
  const locale = getTypingLocale(typingLanguage);

  const {
    text,
    userInput,
    isError,
    totalErrors,
    wpm,
    accuracy,
    state,
    caretPosition,
    handleInputChange,
    inputRef,
    textRefs,
    isIdle,
    elapsedTime,
    wpmHistory,
  } = useTypingGame(selectedLevel, !isBootstrapping, typingLanguage);

  useEffect(() => {
    if (isBootstrapping) return;
    onErrorsChange?.(totalErrors);
  }, [isBootstrapping, totalErrors, onErrorsChange]);

  useEffect(() => {
    if (isBootstrapping) return;
    onWpmHistoryChange?.(wpmHistory);
  }, [isBootstrapping, wpmHistory, onWpmHistoryChange]);

  useEffect(() => {
    if (isBootstrapping) return;
    onStateChange(state);
  }, [isBootstrapping, state, onStateChange]);

  useEffect(() => {
    if (isBootstrapping) return;
    onWpmChange?.(wpm);
  }, [isBootstrapping, wpm, onWpmChange]);

  useEffect(() => {
    if (isBootstrapping) return;
    onAccuracyChange?.(accuracy);
  }, [isBootstrapping, accuracy, onAccuracyChange]);

  useEffect(() => {
    if (isBootstrapping) return;
    onIdleChange?.(isIdle);
  }, [isBootstrapping, isIdle, onIdleChange]);

  useEffect(() => {
    if (isBootstrapping) return;
    onElapsedTimeChange?.(elapsedTime);
  }, [isBootstrapping, elapsedTime, onElapsedTimeChange]);

  useEffect(() => {
    if (isBootstrapping) return;
    onKeyboardPerformanceChange?.(
      buildKeyboardPerformanceData(text, userInput, typingLanguage)
    );
  }, [
    isBootstrapping,
    onKeyboardPerformanceChange,
    text,
    userInput,
    typingLanguage,
  ]);

  if (isBootstrapping) {
    return (
      <div
        className={`relative w-full h-full rounded-md p-4 ${className ?? ""}`}
        aria-busy="true"
        role="status"
        aria-label="Loading typing test"
      >
        <div className="space-y-3 -mt-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-11/12" />
          <Skeleton className="h-6 w-10/12" />
          <Skeleton className="h-6 w-11/12" />
          {/* <Skeleton className="h-6 w-9/12" /> */}

          {/* <div className="pt-4">
            <Skeleton className="h-12 w-full rounded-md" />
          </div> */}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full rounded-md p-4 ${className ?? ""}`}>
      <TextDisplay
        text={text}
        userInput={userInput}
        isError={isError}
        textRefs={textRefs}
        fontSize={fontSize}
        lineHeight={lineHeight}
        font={font}
        optimizePerformance={optimizePerformance}
        dir={dir}
        lang={locale}
      />
      <Caret caretPosition={caretPosition} caretHeight={caretHeight} />
      <TypingInput
        inputRef={inputRef}
        userInput={userInput}
        handleInputChange={handleInputChange}
        fontSizeClassName={fontSize}
        lineHeightClassName={lineHeight}
        dir={dir}
        lang={locale}
      />
    </div>
  );
}