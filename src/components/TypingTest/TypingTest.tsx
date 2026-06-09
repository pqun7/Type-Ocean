"use client";
import { memo, type MutableRefObject, type ReactNode, useEffect } from "react";
import TextDisplay from "./TextDisplay";
import TypingInput from "./TypingInput";
import Caret from "./Caret";
import useTypingGame from "../../features/typing/hooks/useTypingGame";
import { useLevel } from "@/features/level/hooks/useLevel";
import { Skeleton } from "@/components/ui/skeleton";
import { getTypingDir, getTypingLocale, type TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import type { TypingMode } from "@/features/typing/core/typingTypes";
import {
  buildKeyboardPerformanceData,
  type KeyboardPerformanceData,
} from "@/components/TypingTest/utils/keyboardPerformance";

/**
 * Imperative handle exposed via `actionsRef`.
 * Allows parent components (e.g. PvpMatchClient) to focus the hidden input,
 * resync the input state from the server, and read the text-span refs for
 * remote-caret position calculations.
 */
export interface TypingTestActions {
  focus: () => void;
  /** Advance the displayed input to `input` (never rewinds). */
  syncInput: (input: string) => void;
  /** Returns the ref object whose current[] array maps each char to its span. */
  getTextRefs: () => MutableRefObject<(HTMLSpanElement | null)[]>;
}

export type ValidatedTypingStats = {
  totalMistakes: number;
  totalCorrections: number;
  mismatches: number;
};

interface TypingTestProps {
  /** @deprecated Not used; texts come from useTextManager or `controlledText`. */
  texts?: string[];
  fontSize?: string;
  lineHeight?: string;
  font?: string;
  caretHeight?: string;
  /** Extra CSS class on the outer container. */
  className?: string;
  optimizePerformance?: boolean;
  /** Defaults to "MEDIUM" — only used when `controlledText` is NOT supplied. */
  selectedLevel?: "SHORT" | "MEDIUM" | "LONG";
  typingLanguage?: TypingLanguage;
  /** Called when the typing state changes ("start" | "running" | "end"). */
  onStateChange?: (state: "start" | "running" | "end") => void;
  onWpmChange?: (wpm: number) => void;
  onAccuracyChange?: (accuracy: number) => void;
  onIdleChange?: (isIdle: boolean) => void;
  onElapsedTimeChange?: (time: number) => void;
  onWpmHistoryChange?: (history: Array<{ time: number; wpm: number; prevWpm: number }[]>) => void;
  onErrorsChange?: (errors: number) => void;
  onKeyboardPerformanceChange?: (data: KeyboardPerformanceData) => void;
  // ── Controlled / PvP mode ──────────────────────────────────────────────────
  /** When set, bypasses useTextManager and uses this text directly. */
  controlledText?: string;
  /**
   * Called on every validated keystroke with the clean capped input, the
   * number of graphemes typed, and whether the text is now complete.
   * Use this in PvP to send INPUT_UPDATE / FINISH.
   */
  onInputValidated?: (
    input: string,
    graphemesTyped: number,
    isComplete: boolean,
    stats: ValidatedTypingStats,
  ) => void;
  /** Disable the hidden typing input (e.g. during countdown or after a match ends). */
  inputDisabled?: boolean;
  /** Skip XP / stats recording at session end (use for PvP). */
  skipSessionTracking?: boolean;
  /** Typing mode: "normal" (default) or "strict" (locks cursor at first mismatch). */
  mode?: TypingMode;
  /** Attach imperative actions for focus / syncInput / getTextRefs. */
  actionsRef?: MutableRefObject<TypingTestActions | null>;
  /** Override the local-player caret colour (Tailwind bg-* class). */
  caretColorClassName?: string;
  /** Extra content rendered inside the container (e.g. remote carets, overlays). */
  children?: ReactNode;
}

const TypingTest = memo(function TypingTest({
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
  selectedLevel = "MEDIUM",
  typingLanguage = "en",
  controlledText,
  onInputValidated,
  inputDisabled = false,
  skipSessionTracking = false,
  mode,
  actionsRef,
  caretColorClassName,
  children,
}: TypingTestProps) {
  const level = useLevel();
  const isBootstrapping = !!level.isLoadingSession;

  // When a controlled text is provided we never show the loading skeleton —
  // the parent is responsible for not rendering until text is ready.
  const effectiveIsBootstrapping = controlledText !== undefined ? false : isBootstrapping;

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
    resyncInput,
    isIdle,
    elapsedTime,
    wpmHistory,
  } = useTypingGame(selectedLevel, !effectiveIsBootstrapping, typingLanguage, {
    externalText: controlledText,
    onInputValidated,
    skipSessionTracking,
    mode,
  });

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onErrorsChange?.(totalErrors);
  }, [effectiveIsBootstrapping, totalErrors, onErrorsChange]);

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onWpmHistoryChange?.(wpmHistory);
  }, [effectiveIsBootstrapping, wpmHistory, onWpmHistoryChange]);

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onStateChange?.(state);
  }, [effectiveIsBootstrapping, state, onStateChange]);

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onWpmChange?.(wpm);
  }, [effectiveIsBootstrapping, wpm, onWpmChange]);

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onAccuracyChange?.(accuracy);
  }, [effectiveIsBootstrapping, accuracy, onAccuracyChange]);

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onIdleChange?.(isIdle);
  }, [effectiveIsBootstrapping, isIdle, onIdleChange]);

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onElapsedTimeChange?.(elapsedTime);
  }, [effectiveIsBootstrapping, elapsedTime, onElapsedTimeChange]);

  useEffect(() => {
    if (effectiveIsBootstrapping) return;
    onKeyboardPerformanceChange?.(
      buildKeyboardPerformanceData(text, userInput, typingLanguage)
    );
  }, [
    effectiveIsBootstrapping,
    onKeyboardPerformanceChange,
    text,
    userInput,
    typingLanguage,
  ]);

  // Expose imperative actions to parent (used by PvpMatchClient).
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      focus: () => inputRef.current?.focus(),
      syncInput: resyncInput,
      getTextRefs: () => textRefs,
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, resyncInput, textRefs, inputRef]);

  if (effectiveIsBootstrapping) {
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
      <Caret
        caretPosition={caretPosition}
        caretHeight={caretHeight}
        colorClassName={caretColorClassName}
      />
      <TypingInput
        inputRef={inputRef}
        userInput={userInput}
        handleInputChange={handleInputChange}
        fontSizeClassName={fontSize}
        lineHeightClassName={lineHeight}
        dir={dir}
        lang={locale}
        disabled={inputDisabled}
      />
      {children}
    </div>
  );
});

TypingTest.displayName = "TypingTest";

export default TypingTest;