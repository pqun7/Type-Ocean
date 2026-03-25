/**
 * Pure type definitions for the typing engine.
 * No React, no side effects — these can be imported anywhere.
 */

import type { GraphemeSegment } from "@/features/typing/utils/graphemes";

// ── Mode ─────────────────────────────────────────────────────────────────────

/**
 * Controls how strictly the engine enforces correctness.
 *
 * - `"normal"` – errors are tracked but the cursor always advances freely
 *   (standard single-player typing test).
 * - `"strict"` – the cursor is LOCKED at the first incorrect grapheme; the user
 *   must backspace and correct before proceeding (MonkeyType / PvP mode).
 */
export type TypingMode = "normal" | "strict";

// ── Engine config ─────────────────────────────────────────────────────────────

/**
 * Static configuration for a typing session.
 * Created once per match/test and never mutated.
 */
export interface EngineConfig {
  /** Pre-segmented target text (computed once and cached). */
  readonly targetSegments: readonly GraphemeSegment[];
  /** Raw target text (kept for slice operations). */
  readonly targetText: string;
  /** BCP-47 locale tag passed to the Intl.Segmenter (e.g. "en", "ar"). */
  readonly locale: string;
  /** Typing mode for this session. */
  readonly mode: TypingMode;
}

// ── Engine state ──────────────────────────────────────────────────────────────

/**
 * Complete, deterministic snapshot of all typing-engine state.
 * Immutable — every `process*` call returns a **new** object rather than
 * mutating the previous one.
 */
export interface EngineState {
  /** The current (capped, possibly strict-blocked) input string. */
  readonly input: string;

  /** Pre-segmented version of {@link input}, aligned to the target. */
  readonly inputSegments: readonly GraphemeSegment[];

  /**
   * Number of grapheme positions where `inputSegments[i].segment` does not
   * match `targetSegments[i].segment`.  Always ≥ 0.
   */
  readonly mismatches: number;

  /**
   * 0-based grapheme index of the leftmost incorrect grapheme, or `null`
   * when every typed grapheme is correct.
   */
  readonly firstMismatchIndex: number | null;

  /**
   * Total cumulative wrong keypresses (never decreases — corrections do not
   * reduce this count).
   */
  readonly totalMistakes: number;

  /**
   * Total cumulative correction keystrokes (backspaces that removed a wrong
   * grapheme).
   */
  readonly totalCorrections: number;

  /**
   * `true` exactly when:
   *   - all target graphemes have been typed, AND
   *   - `mismatches === 0`
   *
   * Invariant: `isComplete` is impossible in strict mode with active mismatches.
   */
  readonly isComplete: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Initial engine state for a new typing session. */
export const EMPTY_ENGINE_STATE: EngineState = {
  input: "",
  inputSegments: [],
  mismatches: 0,
  firstMismatchIndex: null,
  totalMistakes: 0,
  totalCorrections: 0,
  isComplete: false,
} as const satisfies EngineState;
