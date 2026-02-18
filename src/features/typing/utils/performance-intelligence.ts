/**
 * Performance intelligence module with configurable thresholds,
 * optional quadratic acceleration, dynamic WPM ceiling,
 * and robust stability scoring.
 */

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export type PerformanceIntelligenceDailyActivity = {
  localDate: string;
  sessionsCount: number;
  totalTimeSpentSec?: number;
  sumWpm: number;
  sumWpmTime?: number;
  sumAccuracy: number;
};

export type PerformanceTrendCategory =
  | "ACCELERATING"
  | "IMPROVING"
  | "STABLE"
  | "DECLINING";

export type PerformanceTrend = {
  category: PerformanceTrendCategory;
  pointsUsed: number;
  slopePerDay: number;
  accelerationPerDay2: number;
  r2: number;
  volatilityCv: number;
  stabilityScore: number; // 0-100 (higher is more stable)
};

export type PerformanceComparison = {
  recentWpm: number;
  prevWpm: number;
  wpmDelta: number;
  recentAccuracy: number;
  prevAccuracy: number;
  accuracyDelta: number;
};

export type PerformanceScores = {
  wpmScore: number;
  accuracyScore: number;
  consistencyScore: number;
  cleanlinessScore: number;
  improvementScore: number;
  stabilityScore: number;
  compositeIndex: number;
};

export type PerformanceIntelligence = {
  comparison: PerformanceComparison;
  trend: PerformanceTrend;
  scores: PerformanceScores;
};

export type PerformanceIntelligenceInput = {
  dailyActivity: PerformanceIntelligenceDailyActivity[];
  stats: {
    averageWPM: number;
    averageAccuracy: number;
    averageConsistency: number;
    totalMistakes: number;
    totalCorrections: number;
    totalCharactersTyped: number;
  };
  windowDays?: number;
};

/**
 * Configuration for trend classification and scoring.
 * All fields are optional – defaults are chosen for a general audience.
 */
export type PerformanceIntelligenceConfig = {
  /**
   * WPM ceiling used for score calculation.
   * - If a number, that value is used.
   * - If "dynamic", the 99th percentile of recent daily avgWpm is used (capped at 250).
   * @default 120
   */
  wpmCeiling?: number | "dynamic";

  /**
   * Minimum slope (per day) to be considered improving or declining.
   * @default 0.12
   */
  trendSlopeThreshold?: number;

  /**
   * Minimum acceleration (per day²) to be considered accelerating.
   * @default 0.06
   */
  trendAccelerationThreshold?: number;

  /**
   * Minimum R² for a trend to be considered confident.
   * @default 0.25 (for general classification) and 0.35 (for acceleration)
   */
  trendR2Threshold?: number;

  /**
   * Whether to use statistical significance (p-value) instead of the simple noise heuristic.
   * @default false
   */
  useStatisticalSignificance?: boolean;

  /**
   * P-value threshold for slope significance (used if useStatisticalSignificance is true).
   * @default 0.05
   */
  significancePValue?: number;

  /**
   * Whether to compute acceleration via quadratic regression (true) or the simple split-slope method (false).
   * Quadratic regression is more accurate but slightly heavier.
   * @default false
   */
  useQuadraticAcceleration?: boolean;

  /**
   * Minimum number of points for which stability is considered reliable.
   * When pointsUsed < this, the stability score is penalised.
   * @default 10
   */
  stabilityMinPoints?: number;
};

// ----------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toTimestamp(dateKey: string): number {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
  return Date.UTC(year, month - 1, day);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDevSample(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDevSample(values) / m;
}

/**
 * Linear regression returning slope, intercept, R², and standard error of slope.
 */
function linearRegression(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  if (n < 2) {
    return {
      slope: 0,
      intercept: n === 1 ? y[0] : 0,
      r2: 0,
      slopeStdErr: 0,
    };
  }

  const xSlice = x.slice(0, n);
  const ySlice = y.slice(0, n);

  const xMean = mean(xSlice);
  const yMean = mean(ySlice);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - xMean;
    num += dx * (ySlice[i] - yMean);
    den += dx * dx;
  }

  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  // R²
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yHat = slope * xSlice[i] + intercept;
    ssRes += (ySlice[i] - yHat) ** 2;
    ssTot += (ySlice[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : clamp(1 - ssRes / ssTot, 0, 1);

  // Standard error of slope (for t-test)
  let slopeStdErr = 0;
  if (n > 2 && den !== 0) {
    const residualStd = Math.sqrt(ssRes / (n - 2));
    slopeStdErr = residualStd / Math.sqrt(den);
  }

  return { slope, intercept, r2, slopeStdErr };
}

/**
 * Quadratic regression (degree 2 polynomial) using ordinary least squares.
 * Returns coefficients [a, b, c] for y = a*x² + b*x + c.
 */
function quadraticRegression(x: number[], y: number[]): { a: number; b: number; c: number; r2: number } {
  const n = Math.min(x.length, y.length);
  if (n < 3) {
    return { a: 0, b: 0, c: 0, r2: 0 };
  }

  // Prepare matrix for normal equations: X = [x², x, 1]
  const sumX = x.reduce((s, v) => s + v, 0);
  const sumX2 = x.reduce((s, v) => s + v * v, 0);
  const sumX3 = x.reduce((s, v) => s + v * v * v, 0);
  const sumX4 = x.reduce((s, v) => s + v * v * v * v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumX2Y = x.reduce((s, v, i) => s + v * v * y[i], 0);
  const sumXY = x.reduce((s, v, i) => s + v * y[i], 0);

  // Solve normal equations:
  // [ sumX4 sumX3 sumX2 ] [a] = [sumX2Y]
  // [ sumX3 sumX2 sumX  ] [b]   [sumXY ]
  // [ sumX2 sumX  n     ] [c]   [sumY  ]
  const matrix = [
    [sumX4, sumX3, sumX2],
    [sumX3, sumX2, sumX],
    [sumX2, sumX, n],
  ];
  const rhs = [sumX2Y, sumXY, sumY];

  // Solve 3x3 linear system (Cramer's rule for simplicity, but could use a library for large data)
  const det = determinant3x3(matrix);
  if (Math.abs(det) < 1e-12) {
    return { a: 0, b: 0, c: 0, r2: 0 };
  }

  const detA = determinant3x3([
    [rhs[0], matrix[0][1], matrix[0][2]],
    [rhs[1], matrix[1][1], matrix[1][2]],
    [rhs[2], matrix[2][1], matrix[2][2]],
  ]);
  const detB = determinant3x3([
    [matrix[0][0], rhs[0], matrix[0][2]],
    [matrix[1][0], rhs[1], matrix[1][2]],
    [matrix[2][0], rhs[2], matrix[2][2]],
  ]);
  const detC = determinant3x3([
    [matrix[0][0], matrix[0][1], rhs[0]],
    [matrix[1][0], matrix[1][1], rhs[1]],
    [matrix[2][0], matrix[2][1], rhs[2]],
  ]);

  const a = detA / det;
  const b = detB / det;
  const c = detC / det;

  // Compute R²
  const yMean = mean(y);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yHat = a * x[i] * x[i] + b * x[i] + c;
    ssRes += (y[i] - yHat) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : clamp(1 - ssRes / ssTot, 0, 1);

  return { a, b, c, r2 };
}

function determinant3x3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

// ----------------------------------------------------------------------
// Statistical functions for p-value approximation
// ----------------------------------------------------------------------

/**
 * Standard normal CDF approximation (Abramowitz & Stegun, 26.2.17)
 */
function normalCDF(x: number): number {
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * absX);
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * Cumulative distribution function for t-distribution (Cornish-Fisher approximation)
 */
function tCDF(t: number, df: number): number {
  if (df <= 0) return 0.5;
  // Approximation from "Statistical Computing" by Kennedy & Gentle
  const z = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + t * t / (2 * df));
  return normalCDF(z);
}

/**
 * Two-tailed p-value for a t-statistic with given degrees of freedom.
 * For production use, consider replacing with a dedicated library like jstat or simple-statistics.
 */
function pValueFromT(t: number, df: number): number {
  if (df < 1) return 1.0;
  t = Math.abs(t);
  return 2 * (1 - tCDF(t, df));
}

// ----------------------------------------------------------------------
// Core logic (with configurable improvements)
// ----------------------------------------------------------------------

function buildActiveDailySeries(
  dailyActivity: PerformanceIntelligenceDailyActivity[],
  windowDays: number
): Array<{ localDate: string; avgWpm: number; avgAccuracy: number }> {
  const sorted = [...(dailyActivity ?? [])]
    .filter((row) => safeNumber(row.sessionsCount, 0) > 0)
    .sort((a, b) => toTimestamp(a.localDate) - toTimestamp(b.localDate));

  const normalized = sorted.map((row) => {
    const sessions = Math.max(1, safeNumber(row.sessionsCount, 0));
    const totalTimeSpentSec = safeNumber(row.totalTimeSpentSec, 0);
    const sumWpmTime = safeNumber(row.sumWpmTime, 0);
    const hasTimeWeightedWpm = totalTimeSpentSec > 0 && sumWpmTime > 0;
    const avgWpm = hasTimeWeightedWpm ? sumWpmTime / totalTimeSpentSec : safeNumber(row.sumWpm, 0) / sessions;
    const avgAccuracy = safeNumber(row.sumAccuracy, 0) / sessions;
    return { localDate: row.localDate, avgWpm, avgAccuracy };
  });

  return normalized.slice(Math.max(0, normalized.length - windowDays));
}

function computeDailyPerformanceIndex(avgWpm: number, avgAccuracy: number, wpmCeiling: number): number {
  const wpmScore = clamp(Math.round((safeNumber(avgWpm, 0) / wpmCeiling) * 100), 0, 100);
  const accScore = clamp(Math.round(safeNumber(avgAccuracy, 0)), 0, 100);
  return 0.6 * wpmScore + 0.4 * accScore;
}

function computeComparison(dailySeries: Array<{ avgWpm: number; avgAccuracy: number }>): PerformanceComparison {
  const n = dailySeries.length;
  const recent = dailySeries.slice(Math.max(0, n - 14));
  const prev = dailySeries.slice(Math.max(0, n - 28), Math.max(0, n - 14));

  const recentWpm = mean(recent.map((d) => d.avgWpm));
  const prevWpm = mean(prev.map((d) => d.avgWpm));
  const recentAccuracy = mean(recent.map((d) => d.avgAccuracy));
  const prevAccuracy = mean(prev.map((d) => d.avgAccuracy));

  return {
    recentWpm,
    prevWpm,
    wpmDelta: recentWpm - prevWpm,
    recentAccuracy,
    prevAccuracy,
    accuracyDelta: recentAccuracy - prevAccuracy,
  };
}

function computeImprovementScore(comparison: PerformanceComparison): number {
  const score = 50 + comparison.wpmDelta * 3 + comparison.accuracyDelta * 1.5;
  return clamp(Math.round(score), 0, 100);
}

function computeCleanlinessScore(stats: PerformanceIntelligenceInput["stats"]): number {
  const totalChars = Math.max(1, Math.floor(safeNumber(stats.totalCharactersTyped, 0)));
  const mistakes = Math.max(0, safeNumber(stats.totalMistakes, 0));
  const corrections = Math.max(0, safeNumber(stats.totalCorrections, 0));
  const errorRate = (mistakes + corrections) / totalChars;
  const penaltyFactor = clamp(errorRate * 2.75, 0, 0.28);
  const cleanFactor = 1 - penaltyFactor;
  return clamp(Math.round(cleanFactor * 100), 0, 100);
}

/**
 * Compute stability score, optionally adjusted for small sample size.
 */
function computeStabilityScore(
  performanceSeries: number[],
  minPoints: number
): { volatilityCv: number; stabilityScore: number } {
  const cv = coefficientOfVariation(performanceSeries);
  const baseStability = 100 - clamp(cv * 100, 0, 100);

  // If fewer than minPoints, reduce confidence by scaling stability toward 50 (neutral).
  const n = performanceSeries.length;
  let adjustedStability = baseStability;
  if (n < minPoints) {
    const confidence = n / minPoints; // 0..1
    adjustedStability = baseStability * confidence + 50 * (1 - confidence);
  }

  return {
    volatilityCv: cv,
    stabilityScore: Number(adjustedStability.toFixed(2)),
  };
}

/**
 * Acceleration via split-slope method (original simple approach).
 */
function computeAccelerationSplit(performanceSeries: number[]): number {
  const n = performanceSeries.length;
  if (n < 6) return 0;

  const mid = Math.floor(n / 2);
  const first = performanceSeries.slice(0, mid);
  const second = performanceSeries.slice(mid);

  const x1 = first.map((_, i) => i);
  const x2 = second.map((_, i) => i);

  const r1 = linearRegression(x1, first);
  const r2 = linearRegression(x2, second);

  return r2.slope - r1.slope;
}

/**
 * Acceleration via quadratic regression (more accurate).
 * Returns the second derivative (2*a) as acceleration per index²,
 * along with the R² of the quadratic fit.
 */
function computeAccelerationQuadratic(performanceSeries: number[]): { acceleration: number; r2: number } {
  const n = performanceSeries.length;
  if (n < 3) return { acceleration: 0, r2: 0 };

  const x = performanceSeries.map((_, i) => i);
  const y = performanceSeries;
  const { a, r2 } = quadraticRegression(x, y);
  // acceleration = second derivative = 2*a
  return { acceleration: 2 * a, r2 };
}

/**
 * Classify trend category with configurable thresholds and optional p-value.
 * Now optionally accepts quadraticR2 for acceleration confidence.
 */
function classifyTrend(
  args: {
    slopePerDay: number;
    accelerationPerDay2: number;
    r2: number;
    stdDev: number;
    pointsUsed: number;
    slopeStdErr?: number;
    quadraticR2?: number; // used when quadratic acceleration is enabled
  },
  config: Required<PerformanceIntelligenceConfig>
): PerformanceTrendCategory {
  const {
    slopePerDay,
    accelerationPerDay2,
    r2,
    stdDev,
    pointsUsed,
    slopeStdErr = 0,
    quadraticR2,
  } = args;

  const {
    trendSlopeThreshold,
    trendAccelerationThreshold,
    trendR2Threshold,
    useStatisticalSignificance,
    significancePValue,
  } = config;

  // Determine if slope is significant
  let significant = false;
  if (useStatisticalSignificance && slopeStdErr > 0 && pointsUsed > 2) {
    const p = pValueFromT(slopePerDay / slopeStdErr, pointsUsed - 2);
    significant = p < significancePValue;
  } else {
    // Original heuristic: expected net change > noise * 0.75
    const expectedNetChange = Math.abs(slopePerDay) * Math.max(1, pointsUsed - 1);
    const noise = Math.max(1e-6, stdDev);
    significant = expectedNetChange >= noise * 0.75;
  }

  const confident = r2 >= trendR2Threshold;

  if (!significant || !confident) return "STABLE";

  if (slopePerDay <= -trendSlopeThreshold) return "DECLINING";

  if (slopePerDay >= trendSlopeThreshold) {
    // For acceleration, use quadratic R² if provided, otherwise fallback to linear R²
    const accelR2 = quadraticR2 !== undefined ? quadraticR2 : r2;
    if (accelerationPerDay2 >= trendAccelerationThreshold && accelR2 >= trendR2Threshold + 0.1) {
      return "ACCELERATING";
    }
    return "IMPROVING";
  }

  return "STABLE";
}

function computeCompositeIndex(args: {
  wpmScore: number;
  accuracyScore: number;
  consistencyScore: number;
  cleanlinessScore: number;
  improvementScore: number;
  stabilityScore: number;
}): number {
  const {
    wpmScore,
    accuracyScore,
    consistencyScore,
    cleanlinessScore,
    improvementScore,
    stabilityScore,
  } = args;

  const score =
    wpmScore * 0.25 +
    accuracyScore * 0.2 +
    consistencyScore * 0.15 +
    cleanlinessScore * 0.15 +
    improvementScore * 0.15 +
    stabilityScore * 0.1;

  return clamp(Math.round(score), 0, 100);
}

// ----------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------

const DEFAULT_CONFIG: Required<PerformanceIntelligenceConfig> = {
  wpmCeiling: 120,
  trendSlopeThreshold: 0.12,
  trendAccelerationThreshold: 0.06,
  trendR2Threshold: 0.25,
  useStatisticalSignificance: false,
  significancePValue: 0.05,
  useQuadraticAcceleration: false,
  stabilityMinPoints: 10,
};

export function computePerformanceIntelligence(
  input: PerformanceIntelligenceInput,
  userConfig?: PerformanceIntelligenceConfig
): PerformanceIntelligence {
  // Merge user config with defaults
  const config: Required<PerformanceIntelligenceConfig> = {
    ...DEFAULT_CONFIG,
    ...userConfig,
  };

  const windowDays = Math.max(7, Math.floor(input.windowDays ?? 28));
  const dailySeries = buildActiveDailySeries(input.dailyActivity ?? [], windowDays);

  // Determine dynamic WPM ceiling if requested
  let effectiveWpmCeiling: number;
  if (config.wpmCeiling === "dynamic") {
    const allWpms = dailySeries.map((d) => d.avgWpm);
    if (allWpms.length > 0) {
      // Compute 99th percentile
      const sorted = [...allWpms].sort((a, b) => a - b);
      const p99Index = Math.floor(sorted.length * 0.99);
      const p99 = sorted[Math.min(p99Index, sorted.length - 1)];
      effectiveWpmCeiling = clamp(p99, 80, 250); // reasonable bounds
    } else {
      effectiveWpmCeiling = 120; // fallback
    }
  } else {
    effectiveWpmCeiling = config.wpmCeiling;
  }

  const performanceSeries = dailySeries.map((d) =>
    computeDailyPerformanceIndex(d.avgWpm, d.avgAccuracy, effectiveWpmCeiling)
  );

  // Regression for trend
  const x = performanceSeries.map((_, i) => i);
  const reg = linearRegression(x, performanceSeries);

  // Acceleration (with optional quadratic R²)
  let acceleration: number;
  let quadraticR2: number | undefined;
  if (config.useQuadraticAcceleration) {
    const { acceleration: acc, r2: quadR2 } = computeAccelerationQuadratic(performanceSeries);
    acceleration = acc;
    quadraticR2 = quadR2;
  } else {
    acceleration = computeAccelerationSplit(performanceSeries);
    quadraticR2 = undefined;
  }

  const stdDev = stdDevSample(performanceSeries);
  const { volatilityCv, stabilityScore } = computeStabilityScore(
    performanceSeries,
    config.stabilityMinPoints
  );

  const comparison = computeComparison(dailySeries);
  const improvementScore = computeImprovementScore(comparison);

  // Base scores from overall stats
  const wpmScore = clamp(
    Math.round((safeNumber(input.stats.averageWPM, 0) / effectiveWpmCeiling) * 100),
    0,
    100
  );
  const accuracyScore = clamp(Math.round(safeNumber(input.stats.averageAccuracy, 0)), 0, 100);
  const consistencyScore = clamp(Math.round(safeNumber(input.stats.averageConsistency, 0)), 0, 100);
  const cleanlinessScore = computeCleanlinessScore(input.stats);

  const compositeIndex = computeCompositeIndex({
    wpmScore,
    accuracyScore,
    consistencyScore,
    cleanlinessScore,
    improvementScore,
    stabilityScore,
  });

  const trendCategory = classifyTrend(
    {
      slopePerDay: reg.slope,
      accelerationPerDay2: acceleration,
      r2: reg.r2,
      stdDev,
      pointsUsed: performanceSeries.length,
      slopeStdErr: reg.slopeStdErr,
      quadraticR2: quadraticR2, // pass quadratic R² if available
    },
    config
  );

  return {
    comparison,
    trend: {
      category: trendCategory,
      pointsUsed: performanceSeries.length,
      slopePerDay: Number(reg.slope.toFixed(3)),
      accelerationPerDay2: Number(acceleration.toFixed(3)),
      r2: Number(reg.r2.toFixed(3)),
      volatilityCv: Number(volatilityCv.toFixed(4)),
      stabilityScore: Math.round(stabilityScore),
    },
    scores: {
      wpmScore,
      accuracyScore,
      consistencyScore,
      cleanlinessScore,
      improvementScore,
      stabilityScore: Math.round(stabilityScore),
      compositeIndex,
    },
  };
}