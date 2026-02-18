import { computeDailyActivityStrength } from "../activity-strength";

describe("computeDailyActivityStrength", () => {
  test("returns 0 strength for zero activity", () => {
    const out = computeDailyActivityStrength({
      totalMinutes: 0,
      sessionsCount: 0,
      avgWpm: 0,
      avgAccuracy: 0,
    });

    expect(out.strength100).toBe(0);
    expect(out.rawScore).toBe(0);
  });

  test("increases with more minutes", () => {
    const a = computeDailyActivityStrength({
      totalMinutes: 5,
      sessionsCount: 1,
      avgWpm: 60,
      avgAccuracy: 95,
    });

    const b = computeDailyActivityStrength({
      totalMinutes: 20,
      sessionsCount: 1,
      avgWpm: 60,
      avgAccuracy: 95,
    });

    expect(b.strength100).toBeGreaterThan(a.strength100);
  });

  test("increases with more sessions (all else equal)", () => {
    const a = computeDailyActivityStrength({
      totalMinutes: 10,
      sessionsCount: 1,
      avgWpm: 60,
      avgAccuracy: 95,
    });

    const b = computeDailyActivityStrength({
      totalMinutes: 10,
      sessionsCount: 5,
      avgWpm: 60,
      avgAccuracy: 95,
    });

    expect(b.strength100).toBeGreaterThan(a.strength100);
  });

  test("quality boosts minutes slightly", () => {
    const lowQuality = computeDailyActivityStrength({
      totalMinutes: 20,
      sessionsCount: 2,
      avgWpm: 20,
      avgAccuracy: 80,
    });

    const highQuality = computeDailyActivityStrength({
      totalMinutes: 20,
      sessionsCount: 2,
      avgWpm: 110,
      avgAccuracy: 99,
    });

    expect(highQuality.strength100).toBeGreaterThan(lowQuality.strength100);
  });

  test("diminishing returns via log normalization", () => {
    const small = computeDailyActivityStrength({
      totalMinutes: 5,
      sessionsCount: 1,
      avgWpm: 70,
      avgAccuracy: 95,
    });

    const medium = computeDailyActivityStrength({
      totalMinutes: 20,
      sessionsCount: 1,
      avgWpm: 70,
      avgAccuracy: 95,
    });

    const large = computeDailyActivityStrength({
      totalMinutes: 60,
      sessionsCount: 1,
      avgWpm: 70,
      avgAccuracy: 95,
    });

    const delta1 = medium.strength100 - small.strength100;
    const delta2 = large.strength100 - medium.strength100;

    expect(delta1).toBeGreaterThan(0);
    expect(delta2).toBeGreaterThan(0);
    expect(delta2).toBeLessThan(delta1);
  });
});
