import { computeConsistency } from "../consistency";

describe("computeConsistency", () => {
  test("returns null for empty history", () => {
    expect(computeConsistency([])).toBeNull();
  });

  test("returns null when there is only a single valid point", () => {
    const history = [[{ wpm: 50 }]];
    expect(computeConsistency(history)).toBeNull();
  });

  test("computes percentage consistency for flattened points", () => {
    // Flattened points: [10,20,15,25]
    // mean = 17.5, stdDev ~ 6.45497, cv ~= 0.369, consistency ~= 100 - 36.9 ~= 63.1
    const history = [[{ wpm: 10 }, { wpm: 20 }], [{ wpm: 15 }, { wpm: 25 }]];
    const val = computeConsistency(history as any);
    expect(val).toBeCloseTo(63.11, 2);
  });

  test("ignores invalid points and returns finite percentage", () => {
    const history = [[{ wpm: 10 }, { wpm: NaN as unknown as number }], [{ wpm: 20 }, { wpm: 30 }]];
    const val = computeConsistency(history as any);
    expect(val).not.toBeNull();
    expect(Number.isFinite(val)).toBe(true);
  });
});
