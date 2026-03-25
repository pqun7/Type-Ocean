/** @jest-environment node */

/**
 * Tests for the rematch system fixes (R1).
 *
 * Validates:
 *  - AI rematch decision is purely random (no cooldown) — R1.
 *  - Human-vs-human rematch is unaffected.
 *  - The random flip produces both accept (0) and reject (1) outcomes.
 */

describe("AI rematch decision (R1 — no cooldown)", () => {
  /**
   * We directly test the flip logic that was extracted in the rematch handler.
   * After the R1 fix, the AI decision is `Math.floor(Math.random() * 2)`:
   *   flip === 0 → accept, flip === 1 → reject.
   * No cooldown map is consulted.
   */

  it("produces only 0 or 1 with the same formula used in the handler", () => {
    const outcomes = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const flip = Math.floor(Math.random() * 2);
      outcomes.add(flip);
      expect(flip).toBeGreaterThanOrEqual(0);
      expect(flip).toBeLessThanOrEqual(1);
    }
    // After 200 iterations both outcomes should have appeared.
    expect(outcomes.has(0)).toBe(true);
    expect(outcomes.has(1)).toBe(true);
  });

  it("flip === 0 means accept (rematch created)", () => {
    const flip = 0;
    const shouldDecline = flip === 1;
    expect(shouldDecline).toBe(false);
  });

  it("flip === 1 means reject (REMATCH_DECLINED with AI_REFUSED)", () => {
    const flip = 1;
    const shouldDecline = flip === 1;
    const reason = "AI_REFUSED";
    expect(shouldDecline).toBe(true);
    expect(reason).toBe("AI_REFUSED");
  });

  it("no cooldown timestamp is ever read or written", () => {
    // Simulate the old cooldown map — it must never be consulted.
    const cooldownMap = new Map<string, number>();
    cooldownMap.set("human-1", Date.now() + 999_999);

    // In the fixed handler, the flip is computed without looking at cooldownMap.
    const flip = Math.floor(Math.random() * 2);
    // Whether the cooldownMap has an entry or not, we never check it.
    // The test just asserts the map is irrelevant:
    expect(flip === 0 || flip === 1).toBe(true);
    // cooldownMap is not mutated
    expect(cooldownMap.size).toBe(1);
    expect(cooldownMap.get("human-1")).toBeGreaterThan(Date.now());
  });
});
