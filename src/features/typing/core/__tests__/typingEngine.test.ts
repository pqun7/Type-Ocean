/**
 * Unit tests for the pure typing engine.
 *
 * These tests exercise every public function in typingEngine.ts and verify all
 * six documented invariants (I1–I6).
 */

import {
  createEngineConfig,
  createInitialState,
  processInput,
  processResync,
} from "../typingEngine";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a config in normal mode with a simple ASCII text. */
function cfg(text: string, mode: "normal" | "strict" = "normal") {
  return createEngineConfig(text, "en", mode);
}

// ── 1. Correct typing advances state ─────────────────────────────────────────

test("correct typing advances input and reports no mismatches", () => {
  const config = cfg("hello");
  const s0 = createInitialState();
  const s1 = processInput(config, s0, "h");

  expect(s1.input).toBe("h");
  expect(s1.mismatches).toBe(0);
  expect(s1.firstMismatchIndex).toBeNull();
  expect(s1.isComplete).toBe(false);
  expect(s1.totalMistakes).toBe(0);
});

// ── 2. Incorrect typing in normal mode (no blocking) ─────────────────────────

test("incorrect typing in normal mode does NOT block cursor advance", () => {
  const config = cfg("hello");
  const s0 = createInitialState();
  const s1 = processInput(config, s0, "x");        // wrong first char
  const s2 = processInput(config, s1, "xe");       // continue past mismatch

  expect(s2.inputSegments.length).toBe(2);
  expect(s2.mismatches).toBe(1);                   // 'x' vs 'h'
  expect(s2.firstMismatchIndex).toBe(0);
  expect(s2.totalMistakes).toBeGreaterThanOrEqual(1);
});

// ── 3. Strict mode blocks cursor at first mismatch ───────────────────────────

test("strict mode prevents advancing past the first mismatch", () => {
  const config = cfg("hello", "strict");
  const s0 = createInitialState();
  const s1 = processInput(config, s0, "x");        // wrong → cursor stays at pos 1

  // Trying to add another character should not advance beyond pos 1
  const s2 = processInput(config, s1, "xe");

  expect(s2.inputSegments.length).toBe(1);         // I3: locked at firstMismatch + 1
  expect(s2.input).toBe("x");
  expect(s2.mismatches).toBe(1);
});

// ── 4. Strict mode: backspace removes the mismatch and allows advancing ───────

test("strict mode allows backspace to fix the mismatch and continue", () => {
  const config = cfg("hello", "strict");
  const s0 = createInitialState();
  const s1 = processInput(config, s0, "x");        // wrong
  const s2 = processInput(config, s1, "");         // backspace — remove mismatch
  const s3 = processInput(config, s2, "h");        // correct

  expect(s3.mismatches).toBe(0);
  expect(s3.inputSegments.length).toBe(1);
  expect(s3.firstMismatchIndex).toBeNull();
});

// ── 5. Strict mode: completion only fires with zero mismatches ────────────────

test("strict mode: isComplete requires zero mismatches", () => {
  const config = cfg("hi", "strict");
  const s0 = createInitialState();
  // Type "hi" correctly
  const s1 = processInput(config, s0, "h");
  const s2 = processInput(config, s1, "hi");

  expect(s2.isComplete).toBe(true);
  expect(s2.mismatches).toBe(0);
});

test("normal mode: isComplete fires when all graphemes typed (even with errors)", () => {
  const config = cfg("hi", "normal");
  const s0 = createInitialState();
  const s1 = processInput(config, s0, "hx");       // wrong second char

  // Normal mode: complete as soon as length matches target, errors do NOT block.
  // 'hx' fills all 2 graphemes of "hi" → isComplete is true despite mismatch.
  expect(s1.isComplete).toBe(true);
  expect(s1.mismatches).toBe(1);

  // Corrected input is still complete
  const s2 = processInput(config, s1, "hi");
  expect(s2.isComplete).toBe(true);
  expect(s2.mismatches).toBe(0);
});

// ── 6. Multi-codepoint grapheme: correct sequence matches ────────────────────

test("multi-codepoint grapheme segments are compared as whole units (correct)", () => {
  const textWithFlag = "a\u{1F1FA}\u{1F1F8}b"; // a🇺🇸b — flag is two codepoints
  const config = createEngineConfig(textWithFlag, "en", "normal");
  const s0 = createInitialState();

  // Type "a" + the flag emoji + "b" correctly
  const full = textWithFlag;
  const s1 = processInput(config, s0, full);

  expect(s1.mismatches).toBe(0);
  expect(s1.isComplete).toBe(true);
});

// ── 7. Multi-codepoint grapheme: wrong segment counts as mismatch ─────────────

test("substituting a multi-codepoint grapheme counts as one mismatch", () => {
  const textWithFlag = "a\u{1F1FA}\u{1F1F8}b";   // a🇺🇸b
  const config = createEngineConfig(textWithFlag, "en", "normal");
  const s0 = createInitialState();

  // Replace flag with a plain 'X'
  const wrongInput = "aXb";
  const s1 = processInput(config, s0, wrongInput);

  expect(s1.mismatches).toBe(1);               // only the flag position is wrong
  expect(s1.firstMismatchIndex).toBe(1);
});

// ── 8. IME paste / over-long input is capped to target length (I1) ───────────

test("input longer than the target is silently capped (invariant I1)", () => {
  const config = cfg("abc");
  const s0 = createInitialState();

  // Paste something much longer
  const s1 = processInput(config, s0, "abcdefghij");

  expect(s1.inputSegments.length).toBe(3);     // I1: capped at target
  expect(s1.inputSegments.length).toBeLessThanOrEqual(config.targetSegments.length);
});

// ── 9. processResync: server advance accepted, rollback rejected (I6) ─────────

test("processResync advances state from server but never rewinds (invariant I6)", () => {
  const config = cfg("hello world");
  const s0 = createInitialState();
  const s1 = processInput(config, s0, "hello");

  // Server says we've typed "hello wo" — further than local, so accept
  const s2 = processResync(config, s1, "hello wo");
  expect(s2.input).toBe("hello wo");
  expect(s2.inputSegments.length).toBe(8);

  // Old server packet arrives out of order — shorter than current, reject (I6)
  const s3 = processResync(config, s2, "hel");
  expect(s3).toBe(s2);                         // identity: same object
  expect(s3.input).toBe("hello wo");
});

// ── 10. Completion fires at full correct length ────────────────────────────────

test("isComplete fires when all graphemes typed with zero mismatches", () => {
  const target = "cat";
  const config = cfg(target);
  const s0 = createInitialState();
  const s1 = processInput(config, s0, "c");
  const s2 = processInput(config, s1, "ca");
  const s3 = processInput(config, s2, "cat");

  expect(s3.isComplete).toBe(true);
  expect(s3.mismatches).toBe(0);
  expect(s3.inputSegments.length).toBe(3);
  // Invariant I4: isComplete → length === target (strict also needs mismatches === 0)
  expect(s3.inputSegments.length).toBe(config.targetSegments.length);
});
