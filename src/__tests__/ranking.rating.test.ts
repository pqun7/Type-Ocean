import {
  computeSessionRating,
  getRankInfo,
  updatePerformanceRating,
} from "@/features/ranking/rating";

describe("ranking/rating", () => {
  test("computeSessionRating is bounded", () => {
    const { sessionRating } = computeSessionRating({
      wpm: 999,
      accuracy: 150,
      consistency: 200,
      timeSpentSec: 999999,
    });

    expect(sessionRating).toBeGreaterThanOrEqual(0);
    expect(sessionRating).toBeLessThanOrEqual(3000);
  });

  test("updatePerformanceRating moves toward strong sessions", () => {
    const update = updatePerformanceRating({
      currentRating: 1000,
      currentDeviation: 350,
      wpm: 140,
      accuracy: 98,
      consistency: 90,
      timeSpentSec: 120,
      textLength: 500,
      mistakes: 0,
      corrections: 0,
    });

    expect(update.nextRating).toBeGreaterThan(update.previousRating);
    expect(update.nextDeviation).toBeLessThanOrEqual(update.previousDeviation);
  });

  test("getRankInfo returns consistent tier progress", () => {
    const r = getRankInfo(1000);
    expect(r.progressPct).toBeGreaterThanOrEqual(0);
    expect(r.progressPct).toBeLessThanOrEqual(100);
    expect(typeof r.tier).toBe("string");
    expect(typeof r.nextAtRating === "number" || r.nextAtRating === null).toBe(true);
  });
});
