/**
 * @module participant-stats
 *
 * Pure, stateless helper for computing PvP participant typing statistics.
 *
 * ## Why full-recompute instead of incremental?
 *
 * The previous incremental approach (`updateParticipantMetricsIncremental`) tracked
 * `correctChars` / `mismatchChars` in an external Map and tried to subtract when
 * the user backspaced. This was fundamentally broken: when the user types a character
 * that matches the text, then later backspaces past it and re-types a *different*
 * character, the accumulator decrements the wrong counter — leading to negative
 * values, clamped-at-zero drift, and permanently wrong WPM/accuracy.
 *
 * Full recompute is O(n) where n ≤ 1000 characters (typical typing text length).
 * At 1000 chars / keystroke, that is sub-millisecond — the performance cost is
 * completely negligible compared to the correctness guarantee.
 *
 * See problem P5 and P12 in `problem.md` for full context.
 */

/** Statistics derived from a single full-recompute pass over a participant's input. */
export type ParticipantStats = {
  /**
   * Number of characters in `input` that exactly match the text at the same index.
   * This value is persisted in `MatchLiveParticipantState.correctChars` (JSONB) so
   * it survives a gateway restart without needing a separate accumulator Map.
   */
  readonly correctChars: number;
  /** Number of characters typed that do NOT match the text at the same index. */
  readonly errors: number;
  /**
   * Typing accuracy as a percentage (0–100, one decimal place).
   * `= (correctChars / input.length) * 100` — or 100 when input is empty.
   */
  readonly accuracy: number;
  /**
   * Words per minute, computed from `correctChars` and elapsed time.
   * Uses the standard "5 chars = 1 word" conversion.
   */
  readonly wpm: number;
};

export type PvpParticipantStatsParams = {
  input: string;
  textSnapshot: string;
  startedAtMs: number;
  nowMs: number;
  totalMistakes: number;
};

/**
 * Compute words-per-minute from the number of correctly-typed characters.
 *
 * Uses the standard "5 characters = 1 word" typing measurement convention.
 * Clamps output to [0, 500] to filter sensor noise / impossible values.
 *
 * @param correctChars - Number of characters that exactly match the reference text.
 * @param startedAtMs  - Unix epoch ms when the match entered the `live` state.
 * @param nowMs        - Current Unix epoch ms.
 */
export function computeWpmFromCorrectChars(
  correctChars: number,
  startedAtMs: number,
  nowMs: number,
): number {
  // Minimum 1 ms to avoid division by zero during the first keystroke.
  const elapsedMs = Math.max(1, nowMs - startedAtMs);
  const minutes = elapsedMs / 60_000;
  // "5 chars = 1 word" is the industry-standard WPM normalisation.
  const base = correctChars / 5 / Math.max(minutes, 0.016_667);
  return Math.max(0, Math.min(500, Math.round(base)));
}

/**
 * PvP accuracy counts every wrong keystroke even if it was corrected later.
 *
 * This intentionally differs from the single-player/home accuracy model,
 * which is based on the current final input only.
 */
export function computePvpAccuracyFromMistakes(
  correctChars: number,
  totalMistakes: number,
): number {
  const sanitizedCorrectChars = Math.max(0, Math.trunc(correctChars));
  const sanitizedMistakes = Math.max(0, Math.trunc(totalMistakes));
  const attempts = sanitizedCorrectChars + sanitizedMistakes;

  if (attempts === 0) {
    return 100;
  }

  return Number(((sanitizedCorrectChars / attempts) * 100).toFixed(1));
}

/**
 * Recompute all typing statistics for a participant from scratch.
 *
 * This is the **single source of truth** for WPM, accuracy, and error count.
 * It must be called every time `participant.input` changes (append or backspace).
 *
 * ### Guarantees
 * - Accuracy is always exactly `correctChars / input.length * 100` (or 100 if empty).
 * - `errors` is always exactly `input.length - correctChars`.
 * - WPM is always consistent with `correctChars` and elapsed time.
 * - No external mutable state — function is pure and referentially transparent.
 *
 * @param input         - The full current input string for this participant (may be empty).
 * @param textSnapshot  - The immutable reference text for the match.
 * @param startedAtMs   - Unix epoch ms when the match entered the `live` state.
 * @param nowMs         - Current Unix epoch ms (pass `Date.now()` at the call site).
 *
 * @example
 * ```ts
 * const stats = recomputeParticipantStats("hell", "hello world", match.serverStartAtMs, Date.now());
 * // stats.correctChars === 4
 * // stats.errors       === 0
 * // stats.accuracy     === 100
 * ```
 */
export function recomputeParticipantStats(
  input: string,
  textSnapshot: string,
  startedAtMs: number,
  nowMs: number,
): ParticipantStats {
  let correctChars = 0;

  // O(n) scan — n ≤ textSnapshot.length (callers must clamp input to textSnapshot.length).
  // We only compare up to min(input.length, textSnapshot.length) to be safe.
  const compareLength = Math.min(input.length, textSnapshot.length);
  for (let i = 0; i < compareLength; i++) {
    // Non-null assertion avoided: array-index access on a string always returns a
    // string character (never undefined) when the index is < string.length.
    if (input.charCodeAt(i) === textSnapshot.charCodeAt(i)) {
      correctChars++;
    }
  }

  const errors = input.length - correctChars;

  // Accuracy: 100% for empty input (user hasn't started typing yet).
  const accuracy =
    input.length === 0
      ? 100
      : Number(((correctChars / input.length) * 100).toFixed(1));

  const wpm = computeWpmFromCorrectChars(correctChars, startedAtMs, nowMs);

  return { correctChars, errors, accuracy, wpm } satisfies ParticipantStats;
}

/**
 * Recompute the PvP-facing stats model.
 *
 * Unlike the home/session accuracy metric, PvP accuracy is derived from the
 * authoritative cumulative mistake count reported by the strict typing engine.
 * This preserves historical mistakes even after the player corrects them.
 */
export function recomputePvpParticipantStats(
  params: PvpParticipantStatsParams,
): ParticipantStats {
  const baseStats = recomputeParticipantStats(
    params.input,
    params.textSnapshot,
    params.startedAtMs,
    params.nowMs,
  );
  const totalMistakes = Math.max(0, Math.trunc(params.totalMistakes));

  return {
    correctChars: baseStats.correctChars,
    errors: totalMistakes,
    accuracy: computePvpAccuracyFromMistakes(baseStats.correctChars, totalMistakes),
    wpm: baseStats.wpm,
  } satisfies ParticipantStats;
}
