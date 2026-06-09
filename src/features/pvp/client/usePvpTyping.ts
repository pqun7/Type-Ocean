import { useRef } from "react";
import type { MutableRefObject } from "react";
import type { TypingTestActions, ValidatedTypingStats } from "@/components/TypingTest/TypingTest";

/**
 * Thin adapter hook for PvP typing.
 *
 * Owns the `actionsRef` and wires in `mode: "strict"` (cursor locks at first
 * mismatch, MonkeyType-style) and `skipSessionTracking` (server owns XP).
 * Returns a single `typingTestProps` object that can be spread onto
 * `<TypingTest>` to avoid repeating boilerplate in `PvpMatchClient`.
 */
export default function usePvpTyping(params: {
  controlledText: string;
  onInputValidated: (
    input: string,
    graphemesTyped: number,
    isComplete: boolean,
    stats: ValidatedTypingStats,
  ) => void;
}): {
  actionsRef: MutableRefObject<TypingTestActions | null>;
  typingTestProps: {
    controlledText: string;
    onInputValidated: (
      input: string,
      graphemesTyped: number,
      isComplete: boolean,
      stats: ValidatedTypingStats,
    ) => void;
    mode: "strict";
    skipSessionTracking: true;
    actionsRef: MutableRefObject<TypingTestActions | null>;
  };
} {
  const actionsRef = useRef<TypingTestActions | null>(null);
  return {
    actionsRef,
    typingTestProps: {
      controlledText: params.controlledText,
      onInputValidated: params.onInputValidated,
      mode: "strict",
      skipSessionTracking: true,
      actionsRef,
    },
  };
}
