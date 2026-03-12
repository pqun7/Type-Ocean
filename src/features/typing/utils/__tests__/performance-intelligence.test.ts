import {
  computePerformanceIntelligence,
  type PerformanceIntelligenceDailyActivity,
} from "../performance-intelligence";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildSeries(options: {
  startDate?: { year: number; month: number; day: number };
  days: number;
  wpmAt: (i: number) => number;
  accAt?: (i: number) => number;
}): PerformanceIntelligenceDailyActivity[] {
  const start = options.startDate ?? { year: 2026, month: 1, day: 1 };
  const accAt = options.accAt ?? (() => 95);

  const out: PerformanceIntelligenceDailyActivity[] = [];

  for (let i = 0; i < options.days; i++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const y = date.getUTCFullYear();
    const m = pad2(date.getUTCMonth() + 1);
    const d = pad2(date.getUTCDate());
    const localDate = `${y}-${m}-${d}`;

    const wpm = options.wpmAt(i);
    const accuracy = accAt(i);

    out.push({
      localDate,
      sessionsCount: 1,
      sumWpm: wpm,
      sumAccuracy: accuracy,
    });
  }

  // Shuffle ordering (desc) to ensure the util sorts correctly.
  return out.reverse();
}

describe("computePerformanceIntelligence", () => {
  test("classifies clear accelerating trend", () => {
    // First half: +1 WPM/day, second half: +3 WPM/day
    const dailyActivity = buildSeries({
      days: 28,
      wpmAt: (i) => {
        if (i < 14) return 40 + i * 1;
        const base = 40 + 13 * 1;
        return base + (i - 13) * 3;
      },
    });

    const result = computePerformanceIntelligence({
      dailyActivity,
      stats: {
        averageWPM: 70,
        averageAccuracy: 95,
        averageConsistency: 80,
        totalMistakes: 10,
        totalCorrections: 5,
        totalCharactersTyped: 20000,
      },
      windowDays: 28,
    });

    expect(result.trend.category).toBe("ACCELERATING");
    expect(result.trend.slopePerDay).toBeGreaterThan(0);
    expect(result.trend.accelerationPerDay2).toBeGreaterThan(0);
    expect(result.scores.compositeIndex).toBeGreaterThanOrEqual(0);
    expect(result.scores.compositeIndex).toBeLessThanOrEqual(100);
  });

  test("classifies clear improving trend", () => {
    const dailyActivity = buildSeries({
      days: 28,
      wpmAt: (i) => 45 + i * 2,
    });

    const result = computePerformanceIntelligence({
      dailyActivity,
      stats: {
        averageWPM: 75,
        averageAccuracy: 94,
        averageConsistency: 75,
        totalMistakes: 50,
        totalCorrections: 10,
        totalCharactersTyped: 50000,
      },
    });

    expect(result.trend.category).toBe("IMPROVING");
    expect(result.trend.slopePerDay).toBeGreaterThan(0.12);
    expect(Math.abs(result.trend.accelerationPerDay2)).toBeLessThan(0.2);
  });

  test("classifies clear declining trend", () => {
    const dailyActivity = buildSeries({
      days: 28,
      wpmAt: (i) => 100 - i * 2.2,
    });

    const result = computePerformanceIntelligence({
      dailyActivity,
      stats: {
        averageWPM: 85,
        averageAccuracy: 93,
        averageConsistency: 70,
        totalMistakes: 20,
        totalCorrections: 8,
        totalCharactersTyped: 35000,
      },
    });

    expect(result.trend.category).toBe("DECLINING");
    expect(result.trend.slopePerDay).toBeLessThan(0);
  });

  test("classifies low-signal noisy series as stable", () => {
    const dailyActivity = buildSeries({
      days: 28,
      wpmAt: (i) => 70 + (i % 2 === 0 ? 3 : -3),
      accAt: (i) => 94 + (i % 3 === 0 ? 1 : -1),
    });

    const result = computePerformanceIntelligence({
      dailyActivity,
      stats: {
        averageWPM: 70,
        averageAccuracy: 94,
        averageConsistency: 78,
        totalMistakes: 100,
        totalCorrections: 40,
        totalCharactersTyped: 80000,
      },
    });

    expect(result.trend.category).toBe("STABLE");
  });

  test("stability score is higher for low volatility", () => {
    const stableActivity = buildSeries({
      days: 28,
      wpmAt: () => 70,
      accAt: () => 95,
    });

    const volatileActivity = buildSeries({
      days: 28,
      wpmAt: (i) => (i % 2 === 0 ? 50 : 95),
      accAt: (i) => (i % 2 === 0 ? 88 : 98),
    });

    const stable = computePerformanceIntelligence({
      dailyActivity: stableActivity,
      stats: {
        averageWPM: 70,
        averageAccuracy: 95,
        averageConsistency: 80,
        totalMistakes: 10,
        totalCorrections: 5,
        totalCharactersTyped: 20000,
      },
    });

    const volatile = computePerformanceIntelligence({
      dailyActivity: volatileActivity,
      stats: {
        averageWPM: 70,
        averageAccuracy: 95,
        averageConsistency: 80,
        totalMistakes: 10,
        totalCorrections: 5,
        totalCharactersTyped: 20000,
      },
    });

    expect(stable.trend.stabilityScore).toBeGreaterThan(volatile.trend.stabilityScore);
  });

  test("keeps a brand-new user profile balanced around the center", () => {
    const result = computePerformanceIntelligence({
      dailyActivity: [],
      stats: {
        averageWPM: 0,
        averageAccuracy: 0,
        averageConsistency: 0,
        totalMistakes: 0,
        totalCorrections: 0,
        totalCharactersTyped: 0,
      },
    });

    expect(result.trend.category).toBe("STABLE");
    expect(result.scores.wpmScore).toBe(50);
    expect(result.scores.accuracyScore).toBe(50);
    expect(result.scores.consistencyScore).toBe(50);
    expect(result.scores.cleanlinessScore).toBe(50);
    expect(result.scores.stabilityScore).toBe(50);
  });
});
