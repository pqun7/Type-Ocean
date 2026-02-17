import { computeWeightedPerSessionConsistency } from "../consistency";

describe("computeWeightedPerSessionConsistency", () => {
  test("returns 0 for empty history", () => {
    expect(computeWeightedPerSessionConsistency([])).toBe(0);
  });

  test("returns 0 when sessions have single point only", () => {
    const history = [[{ wpm: 50 }], [{ wpm: 60 }]];
    expect(computeWeightedPerSessionConsistency(history)).toBe(0);
  });

  test("computes pooled stdev for two sessions", () => {
    // session1 points [10,20] -> sample variance = 50
    // session2 points [15,25] -> sample variance = 50
    // weighted pooled variance = (50*2 + 50*2) / 4 = 50 => stdev = sqrt(50) ~ 7.071
    const history = [[{ wpm: 10 }, { wpm: 20 }], [{ wpm: 15 }, { wpm: 25 }]];
    const val = computeWeightedPerSessionConsistency(history);
    expect(val).toBeCloseTo(Math.sqrt(50), 3);
  });

  test("ignores invalid points and returns finite number", () => {
    const history = [[{ wpm: 10 }, { wpm: NaN as unknown as number }], [{ wpm: 20 }, { wpm: 30 }]];
    const val = computeWeightedPerSessionConsistency(history as any);
    expect(Number.isFinite(val)).toBe(true);
  });
});
