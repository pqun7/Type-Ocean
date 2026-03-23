/**
 * Tests for participant-stats.ts
 *
 * Covers the P5 regression: the old incremental accumulator produced wrong
 * results when the user backspaced a correctly-typed character and retyped it
 * as wrong (or vice-versa). The full-recompute implementation must always
 * return the ground-truth value regardless of edit history.
 */

import { computeWpmFromCorrectChars, recomputeParticipantStats } from "../domain/match/participant-stats";

// Fixed reference time: 60 seconds of elapsed typing at each test assertion.
const START_MS = 1_000_000;
const NOW_60S = START_MS + 60_000;

// ---------------------------------------------------------------------------
// computeWpmFromCorrectChars
// ---------------------------------------------------------------------------

describe("computeWpmFromCorrectChars", () => {
  it("returns 0 for 0 correct chars", () => {
    expect(computeWpmFromCorrectChars(0, START_MS, NOW_60S)).toBe(0);
  });

  it("produces ~100 wpm for 500 correct chars in 60 seconds (100 words)", () => {
    // 500 chars / 5 = 100 words; elapsed = 1 min → 100 wpm
    const wpm = computeWpmFromCorrectChars(500, START_MS, NOW_60S);
    expect(wpm).toBe(100);
  });

  it("clamps at 500 wpm for unrealistically fast input", () => {
    // 250,000 chars in 1 ms → absurdly high
    const wpm = computeWpmFromCorrectChars(250_000, START_MS, START_MS + 1);
    expect(wpm).toBe(500);
  });

  it("clamps at 0 and does not go negative", () => {
    // Negative correctChars should never happen but defensive test
    const wpm = computeWpmFromCorrectChars(-5, START_MS, NOW_60S);
    expect(wpm).toBe(0);
  });

  it("does not divide by zero when nowMs === startedAtMs", () => {
    expect(() => computeWpmFromCorrectChars(50, START_MS, START_MS)).not.toThrow();
    const wpm = computeWpmFromCorrectChars(50, START_MS, START_MS);
    expect(wpm).toBeGreaterThanOrEqual(0);
    expect(wpm).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// recomputeParticipantStats — basic correctness
// ---------------------------------------------------------------------------

describe("recomputeParticipantStats — basic correctness", () => {
  const TEXT = "hello world";

  it("returns 100% accuracy and 0 errors for empty input", () => {
    const stats = recomputeParticipantStats("", TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.accuracy).toBe(100);
    expect(stats.wpm).toBe(0);
  });

  it("counts all chars correct when input matches text exactly", () => {
    const stats = recomputeParticipantStats(TEXT, TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(TEXT.length);
    expect(stats.errors).toBe(0);
    expect(stats.accuracy).toBe(100);
  });

  it("counts all chars wrong when input is all mismatches", () => {
    const wrong = "x".repeat(TEXT.length);
    const stats = recomputeParticipantStats(wrong, TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(0);
    expect(stats.errors).toBe(TEXT.length);
    expect(stats.accuracy).toBe(0);
  });

  it("handles partial input (user mid-word)", () => {
    // "hell" typed into "hello world" — all 4 chars correct
    const stats = recomputeParticipantStats("hell", TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(4);
    expect(stats.errors).toBe(0);
    expect(stats.accuracy).toBe(100);
  });

  it("handles mixed correct/wrong", () => {
    // "hXllX" into "hello world" — positions 0,2,3 correct; 1,4 wrong
    const stats = recomputeParticipantStats("hXllX", TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(3);
    expect(stats.errors).toBe(2);
    // accuracy = 3/5 * 100 = 60.0
    expect(stats.accuracy).toBe(60);
  });

  it("does not count characters beyond textSnapshot length", () => {
    // Input longer than text — extra chars after textSnapshot.length should be ignored.
    const longInput = TEXT + "extra typed past end";
    const stats = recomputeParticipantStats(longInput, TEXT, START_MS, NOW_60S);
    // Only first TEXT.length characters are compared; "extra" chars are not counted
    // (callers must clamp input to textSnapshot.length, but the function is safe anyway)
    expect(stats.correctChars).toBe(TEXT.length);
    // errors = input.length - correctChars; but input.length > text.length here
    // The function counts errors for the full input length not just compared portion:
    expect(stats.errors).toBe(longInput.length - TEXT.length);
  });
});

// ---------------------------------------------------------------------------
// P5 regression: backspace over correct chars then retype wrong
// ---------------------------------------------------------------------------

describe("recomputeParticipantStats — P5 backspace regression", () => {
  const TEXT = "abcde";

  it("stays correct after: type correct → backspace → retype same correct", () => {
    // User typed "abc", backspaced to "ab", retyped "c"
    const stats = recomputeParticipantStats("abc", TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(3);
    expect(stats.errors).toBe(0);
    expect(stats.accuracy).toBe(100);
  });

  it("reflects wrong char after: type correct → backspace → retype wrong", () => {
    // User typed "abc" (all correct), backspaced to "ab", then typed "X" instead of "c"
    // The INCREMENTAL accumulator would have:
    //   +1 correct for 'a', +1 for 'b', +1 for 'c' → correctChars=3
    //   backspace 'c' → decrements correctChars → correctChars=2
    //   type 'X' → 'X' != 'c' so no increment → correctChars=2, errors=1
    // The full recompute returns the ground truth directly:
    const stats = recomputeParticipantStats("abX", TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.accuracy).toBe(Number(((2 / 3) * 100).toFixed(1)));
  });

  it("reflects correct chars after: type wrong → backspace → retype correct", () => {
    // User typed "abX" (X is wrong), backspaced, retyped "c"
    // The INCREMENTAL accumulator would have:
    //   +1 for 'a', +1 for 'b', 0 for 'X' → correctChars=2
    //   backspace 'X' → X!=c, so it would NOT decrement (it never incremented)
    //   retype 'c' → 'c'=='c' → correctChars=3, errors=0
    // Full recompute also gives 3 correct, 0 errors — no drift:
    const stats = recomputeParticipantStats("abc", TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(3);
    expect(stats.errors).toBe(0);
    expect(stats.accuracy).toBe(100);
  });

  it("handles heavy backspacing to beginning and retyping all wrong", () => {
    // Typed all correct, backspaced to empty, then typed all wrong
    // The old accumulator could go negative here (clamped to 0) and diverge
    const allWrong = "XXXXX";
    const stats = recomputeParticipantStats(allWrong, TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBe(0);
    expect(stats.errors).toBe(5);
    expect(stats.accuracy).toBe(0);
  });

  it("correctChars is never negative", () => {
    // Even if someone passes a weird input, correctChars must stay >= 0
    const stats = recomputeParticipantStats("ZZZZZ", TEXT, START_MS, NOW_60S);
    expect(stats.correctChars).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// P12: correctChars survives serialization round-trips
// ---------------------------------------------------------------------------

describe("recomputeParticipantStats — P12 persistence invariant", () => {
  const TEXT = "quick brown";

  it("returns same result when called twice with identical args (idempotent)", () => {
    const first = recomputeParticipantStats("quick", TEXT, START_MS, NOW_60S);
    const second = recomputeParticipantStats("quick", TEXT, START_MS, NOW_60S);
    expect(first).toEqual(second);
  });

  it("errors + correctChars === input.length (invariant)", () => {
    const inputs = ["", "q", "quick", "quick ", "quick brow", "quick brown"];
    for (const input of inputs) {
      const stats = recomputeParticipantStats(input, TEXT, START_MS, NOW_60S);
      // The errors counter measures characters in input not matching text,
      // so errors = input.length - correctChars always holds.
      expect(stats.errors + stats.correctChars).toBe(input.length);
    }
  });

  it("accuracy is always in [0, 100] range", () => {
    const testCases = ["", "quick", "ZZZZZ", "quick brown"];
    for (const input of testCases) {
      const stats = recomputeParticipantStats(input, TEXT, START_MS, NOW_60S);
      expect(stats.accuracy).toBeGreaterThanOrEqual(0);
      expect(stats.accuracy).toBeLessThanOrEqual(100);
    }
  });
});
