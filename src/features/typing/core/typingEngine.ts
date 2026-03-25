/**
 * Pure, deterministic typing engine — zero React, zero side effects.
 *
 * This module is the **single source of truth** for all input-processing logic.
 * Every function is a pure transformation: given the same inputs, it always
 * produces the same output and never reads or writes any external state.
 *
 * Architecture contract
 * ─────────────────────
 * - `useTypingLogic`  wraps these functions with React state and session lifecycle.
 * - `TypingTest`      is a pure rendering layer.
 * - `usePvpTyping`    configures `mode: "strict"` and bridges to the PvP socket.
 *
 * Invariants upheld by this module
 * ──────────────────────────────────
 * I1. engineState.inputSegments.length ≤ config.targetSegments.length
 * I2. engineState.mismatches ≥ 0
 * I3. mode === "strict" && mismatches > 0
 *       → inputSegments.length ≤ firstMismatchIndex + 1
 * I4. isComplete → inputSegments.length === targetSegments.length
 *       && (mode === "strict" ? mismatches === 0 : true)
 * I5. newState.totalMistakes ≥ prevState.totalMistakes  (monotonically non-decreasing)
 * I6. processResync(serverInput where serverInput.length ≤ prev.input.length)
 *       → returns prevState unchanged
 */

import { segmentGraphemes, type GraphemeSegment } from "@/features/typing/utils/graphemes";
import type { EngineConfig, EngineState, TypingMode } from "./typingTypes";
import { EMPTY_ENGINE_STATE } from "./typingTypes";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create an {@link EngineConfig} for a new typing session.
 *
 * The target text is segmented once here and cached inside the config so that
 * all subsequent `processInput` / `processResync` calls can use a pre-computed
 * segment array instead of re-segmenting on every keystroke.
 *
 * @param targetText - The full text the user must type.
 * @param locale     - BCP-47 locale for grapheme segmentation (e.g. "en", "ar").
 * @param mode       - `"normal"` (advance freely) or `"strict"` (lock on first error).
 */
export function createEngineConfig(
  targetText: string,
  locale: string,
  mode: TypingMode
): EngineConfig {
  return {
    targetText,
    targetSegments: segmentGraphemes(targetText, locale),
    locale,
    mode,
  };
}

/**
 * Return the initial empty {@link EngineState}.
 * Exported as a convenience; identical to the module-level {@link EMPTY_ENGINE_STATE}.
 */
export function createInitialState(): EngineState {
  return EMPTY_ENGINE_STATE;
}

/**
 * Process a raw input string from a DOM input event (or any source) and return
 * the next {@link EngineState}.
 *
 * This function handles **all** of:
 * - Capping input at the target grapheme length (invariant I1)
 * - Incremental mismatch detection with fast paths for append/backspace
 * - `firstMismatchIndex` tracking
 * - Strict-mode cursor locking (invariant I3)
 * - Cumulative `totalMistakes` / `totalCorrections` accounting
 * - Completion detection (invariant I4)
 *
 * @param config    - Static session configuration (created once per match/test).
 * @param prevState - The most recent engine state.
 * @param rawInput  - The verbatim string from the input element.
 * @returns A **new** EngineState (prevState is never mutated).
 */
export function processInput(
  config: EngineConfig,
  prevState: EngineState,
  rawInput: string
): EngineState {
  const { targetSegments, locale, mode } = config;
  const maxGraphemes = targetSegments.length;

  // ── Step 1: segment and cap the raw input ────────────────────────────────
  const rawSegments = segmentGraphemes(rawInput, locale);
  const cappedSegments: GraphemeSegment[] =
    maxGraphemes > 0 && rawSegments.length > maxGraphemes
      ? rawSegments.slice(0, maxGraphemes)
      : rawSegments;

  const cappedInput: string =
    maxGraphemes > 0 && rawSegments.length > maxGraphemes
      ? rawInput.slice(0, rawSegments[maxGraphemes - 1]!.end)
      : rawInput;

  // ── Step 2: compute mismatches (incremental fast paths) ──────────────────
  const mismatchResult = computeMismatches(
    config,
    prevState,
    cappedSegments,
    cappedInput
  );

  let { mismatches, firstMismatchIndex } = mismatchResult;

  // ── Step 3: strict-mode cursor lock ──────────────────────────────────────
  // If the user typed past a mismatch in strict mode (can happen on paste, IME
  // commit, or autocorrect), trim the input back to firstMismatchIndex + 1.
  let finalSegments = cappedSegments;
  let finalInput = cappedInput;

  if (mode === "strict" && firstMismatchIndex !== null) {
    const maxAllowed = firstMismatchIndex + 1;
    if (finalSegments.length > maxAllowed) {
      finalSegments = finalSegments.slice(0, maxAllowed);
      // Slice the raw string to the end of the last allowed grapheme.
      finalInput = finalInput.slice(0, finalSegments[finalSegments.length - 1]!.end);
      // Re-compute mismatches on the trimmed segments
      const re = computeMismatches(config, prevState, finalSegments, finalInput);
      mismatches = re.mismatches;
      firstMismatchIndex = re.firstMismatchIndex;
    }
  }

  // ── Step 4: cumulative mistakes / corrections ─────────────────────────────
  const { totalMistakes, totalCorrections } = computeCumulativeStats(
    prevState,
    finalInputsAsString(prevState),
    finalInput,
    finalSegments,
    targetSegments
  );

  // ── Step 5: completion ────────────────────────────────────────────────────
  // In strict mode completion is impossible while there are active mismatches
  // (invariant I4).  In normal mode completion fires as soon as all graphemes
  // are typed, regardless of correctness.
  const isComplete =
    maxGraphemes > 0 &&
    finalSegments.length === maxGraphemes &&
    (mode === "strict" ? mismatches === 0 : true);

  return {
    input: finalInput,
    inputSegments: finalSegments,
    mismatches,
    firstMismatchIndex,
    totalMistakes,
    totalCorrections,
    isComplete,
  };
}

/**
 * Advance the engine state to a server-authoritative input value (reconnect
 * resync or MATCH_STATE replay).
 *
 * Safety rules:
 * - If `serverInput` is shorter than or equal to the current local input, the
 *   local state is returned unchanged (invariant I6 — never roll back progress).
 * - The server input is capped to the target grapheme length (invariant I1).
 * - Mode is **not** applied here: the server is authoritative, so we never
 *   re-block a synced position (the server already validated it).
 *
 * @param config      - Static session configuration.
 * @param prevState   - The current local engine state.
 * @param serverInput - The authoritative input string from the server.
 */
export function processResync(
  config: EngineConfig,
  prevState: EngineState,
  serverInput: string
): EngineState {
  // I6: never rewind
  if (serverInput.length <= prevState.input.length) {
    return prevState;
  }

  const { targetSegments, locale } = config;
  const inputSegs = segmentGraphemes(serverInput, locale);
  const cappedSegs = inputSegs.slice(0, targetSegments.length);
  const cappedInput =
    cappedSegs.length < inputSegs.length
      ? serverInput.slice(0, cappedSegs[cappedSegs.length - 1]?.end ?? 0)
      : serverInput;

  // Full mismatch scan (no incremental optimisation — resync is rare)
  let mismatches = 0;
  let firstMismatchIndex: number | null = null;
  for (let i = 0; i < cappedSegs.length; i += 1) {
    if (cappedSegs[i]!.segment !== targetSegments[i]!.segment) {
      mismatches += 1;
      if (firstMismatchIndex === null) firstMismatchIndex = i;
    }
  }

  const isComplete =
    targetSegments.length > 0 &&
    cappedSegs.length === targetSegments.length &&
    mismatches === 0;

  // totalMistakes carries forward from prevState — server resync does not
  // retroactively add or remove mistake counts.
  return {
    input: cappedInput,
    inputSegments: cappedSegs,
    mismatches,
    firstMismatchIndex,
    totalMistakes: prevState.totalMistakes,
    totalCorrections: prevState.totalCorrections,
    isComplete,
  };
}

/**
 * Find the 0-based grapheme index of the first mismatch between two segment
 * arrays, or return `null` if all positions match.
 *
 * Only the overlapping prefix (up to `min(a.length, b.length)`) is compared.
 *
 * @param inputSegments  - Segments of what the user typed.
 * @param targetSegments - Segments of the target text.
 */
export function findFirstMismatch(
  inputSegments: readonly GraphemeSegment[],
  targetSegments: readonly GraphemeSegment[]
): number | null {
  const len = Math.min(inputSegments.length, targetSegments.length);
  for (let i = 0; i < len; i += 1) {
    if (inputSegments[i]!.segment !== targetSegments[i]!.segment) return i;
  }
  return null;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Extract the input string held inside an EngineState (helper for clarity). */
function finalInputsAsString(state: EngineState): string {
  return state.input;
}

/**
 * Compute `mismatches` and `firstMismatchIndex` from the new (capped) segment
 * array.  Uses incremental paths for append and backspace to keep this O(delta)
 * in the common case instead of O(n).
 */
function computeMismatches(
  config: EngineConfig,
  prevState: EngineState,
  nextSegments: readonly GraphemeSegment[],
  nextInput: string
): { mismatches: number; firstMismatchIndex: number | null } {
  const { targetSegments } = config;
  const { inputSegments: prevSegments, input: prevInput, mismatches: prevMismatches } = prevState;

  const prevTyped = prevSegments.length;
  const nextTyped = nextSegments.length;

  let mismatches = prevMismatches;

  // ── Common fast path: pure append ────────────────────────────────────────
  if (nextTyped >= prevTyped && nextInput.startsWith(prevInput)) {
    for (let i = prevTyped; i < nextTyped; i += 1) {
      if (nextSegments[i]!.segment !== targetSegments[i]!.segment) mismatches += 1;
    }
  }
  // ── Common fast path: pure backspace ─────────────────────────────────────
  else if (nextTyped < prevTyped && prevInput.startsWith(nextInput)) {
    for (let i = nextTyped; i < prevTyped; i += 1) {
      if (prevSegments[i]!.segment !== targetSegments[i]!.segment) mismatches -= 1;
    }
  }
  // ── Fallback: paste, autocorrect, mid-string edit — full scan ────────────
  else {
    mismatches = 0;
    for (let i = 0; i < nextTyped; i += 1) {
      if (nextSegments[i]!.segment !== targetSegments[i]!.segment) mismatches += 1;
    }
  }

  mismatches = Math.max(0, mismatches);

  // Find the leftmost error position
  const firstMismatchIndex = findFirstMismatch(nextSegments, targetSegments);

  return { mismatches, firstMismatchIndex };
}

/**
 * Compute updated cumulative `totalMistakes` and `totalCorrections` by
 * examining the diff between the previous and next input strings.
 *
 * Uses common prefix/suffix analysis to pinpoint the edit region.  The result
 * is robust to arbitrary edits (paste, delete-word, etc.).
 */
function computeCumulativeStats(
  prevState: EngineState,
  prevInput: string,
  nextInput: string,
  nextSegments: readonly GraphemeSegment[],
  targetSegments: readonly EngineConfig["targetSegments"][number][]
): { totalMistakes: number; totalCorrections: number } {
  let { totalMistakes, totalCorrections } = prevState;

  if (nextInput === prevInput) {
    return { totalMistakes, totalCorrections };
  }

  const prevLen = prevInput.length;
  const nextLen = nextInput.length;

  // Determine the common-prefix and common-suffix bounds.
  let prefix = 0;
  let suffix = 0;

  if (nextLen >= prevLen && nextInput.startsWith(prevInput)) {
    // Fast path: pure append
    prefix = prevLen;
  } else if (nextLen < prevLen && prevInput.startsWith(nextInput)) {
    // Fast path: pure backspace
    prefix = nextLen;
  } else {
    // General diff
    while (
      prefix < prevLen &&
      prefix < nextLen &&
      prevInput[prefix] === nextInput[prefix]
    ) {
      prefix += 1;
    }
    while (
      suffix < prevLen - prefix &&
      suffix < nextLen - prefix &&
      prevInput[prevLen - 1 - suffix] === nextInput[nextLen - 1 - suffix]
    ) {
      suffix += 1;
    }
  }

  const removed = Math.max(0, prevLen - (prefix + suffix));
  const added = Math.max(0, nextLen - (prefix + suffix));

  // Corrections: backspaced characters (removal from the input)
  if (removed > 0 && nextLen < prevLen) {
    totalCorrections += removed;
  }

  // Mistakes: newly added characters that do not match the target
  if (added > 0) {
    const addedStart = prefix;
    const addedEnd = nextLen - suffix;
    let addedMistakes = 0;
    // Compare by grapheme where possible, fall back to raw character comparison.
    for (let i = addedStart; i < addedEnd; i += 1) {
      if (nextInput[i] !== undefined) {
        const inputChar = nextInput[i]!;
        const targetChar = targetSegments[i]?.segment ?? "";
        if (inputChar !== targetChar) addedMistakes += 1;
      }
    }
    totalMistakes += addedMistakes;
  }

  return { totalMistakes, totalCorrections };
}

// Re-export key types for consumers that only import from this module.
export type { EngineConfig, EngineState, TypingMode } from "./typingTypes";
export { EMPTY_ENGINE_STATE } from "./typingTypes";
