export type RankTier =
  | "Prime"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Diamond"
  | "Legendary";

export type RankInfo = {
  rating: number;
  tier: RankTier;
  tierMinRating: number;
  tierMaxRating: number | null;
  progressPct: number; // 0..100 within current tier
  nextAtRating: number | null;
};

export type RatingUpdate = {
  previousRating: number;
  previousDeviation: number;
  sessionRating: number;
  nextRating: number;
  nextDeviation: number;
  delta: number;
};

export const DEFAULT_RATING = 1000;
export const DEFAULT_RATING_DEVIATION = 350;

const MIN_RATING = 0;
const MAX_RATING = 3000;
const MIN_DEVIATION = 60;
const MAX_DEVIATION = 350;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function smoothstep01(x: number) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

export function isRatedSession(input: { timeSpentSec?: number; textLength?: number }) {
  const timeSpentSec = clamp(Math.floor(safeNumber(input.timeSpentSec, 0)), 0, 7200);
  const textLength = clamp(Math.floor(safeNumber(input.textLength, 0)), 0, 1_000_000);

  // Require a minimum amount of real effort before affecting rank.
  return timeSpentSec >= 15 && textLength >= 120;
}

function computeRatedWeight(input: {
  wpm: number;
  timeSpentSec?: number;
  textLength?: number;
  mistakes?: number;
  corrections?: number;
}): number {
  const timeSpentSec = clamp(Math.floor(safeNumber(input.timeSpentSec, 0)), 0, 7200);
  const textLength = clamp(Math.floor(safeNumber(input.textLength, 0)), 0, 1_000_000);
  const mistakes = clamp(Math.floor(safeNumber(input.mistakes, 0)), 0, 1_000_000);
  const corrections = clamp(Math.floor(safeNumber(input.corrections, 0)), 0, 1_000_000);
  const wpm = clamp(safeNumber(input.wpm, 0), 0, 500);

  if (!isRatedSession({ timeSpentSec, textLength })) return 0;

  // Effort weighting: full weight at ~2 minutes and a reasonable text length.
  const timeFactor = smoothstep01((timeSpentSec - 15) / 105); // 15s..120s
  const lengthFactor = smoothstep01((textLength - 120) / 480); // 120..600 chars

  // Plausibility: keep wpm/time/textLength internally consistent to avoid weird payloads.
  // Approx expected chars typed ≈ words * 5, words ≈ wpm * minutes.
  const expectedChars = wpm * (timeSpentSec / 60) * 5;
  const ratio = expectedChars / Math.max(1, textLength);
  const ratioClamped = clamp(ratio, 0.25, 4);
  const plausibility = clamp(1 - Math.abs(Math.log2(ratioClamped)) / 2, 0.2, 1);

  // Discipline: lots of corrections/mistakes should have less impact.
  const per100 = (mistakes + 0.5 * corrections) / Math.max(1, textLength / 100);
  const discipline = clamp(1 - per100 * 0.04, 0.5, 1);

  const weight = timeFactor * (0.35 + 0.65 * lengthFactor) * plausibility * discipline;
  return clamp(weight, 0, 1);
}

/**
 * Converts one typing session into an approximate skill rating on a 0..3000 scale.
 * This is not PvP MMR; it is a performance index that mixes speed + accuracy + consistency.
 */
export function computeSessionRating(input: {
  wpm: number;
  accuracy: number;
  consistency?: number;
  timeSpentSec?: number;
  textLength?: number;
  mistakes?: number;
  corrections?: number;
}): { sessionRating: number; weight: number } {
  const wpm = clamp(safeNumber(input.wpm, 0), 0, 500);
  const accuracy = clamp(safeNumber(input.accuracy, 0), 0, 100);
  const consistency = clamp(safeNumber(input.consistency, 0), 0, 100);
  const weight = computeRatedWeight({
    wpm,
    timeSpentSec: input.timeSpentSec,
    textLength: input.textLength,
    mistakes: input.mistakes,
    corrections: input.corrections,
  });

  // Speed saturates: early improvements matter more than extreme WPM.
  const wpmScore = clamp(1 - Math.exp(-wpm / 80), 0, 1);

  // Accuracy is intentionally steep: high accuracy is rewarded.
  const accScore = Math.pow(clamp(accuracy / 100, 0, 1), 2.2);

  // Consistency is useful but optional and lower-weighted.
  const consScore = Math.pow(clamp(consistency / 100, 0, 1), 1.5);

  const composite = clamp(0.65 * wpmScore + 0.25 * accScore + 0.1 * consScore, 0, 1);
  const sessionRating = Math.round(MAX_RATING * composite);

  return { sessionRating, weight };
}

/**
 * Updates a player's performance-based rating using a deviation-controlled EMA.
 * - Deviation starts high and shrinks as more weighted sessions are recorded.
 * - Rating changes are bounded by session weight and current deviation.
 */
export function updatePerformanceRating(input: {
  currentRating?: number | null;
  currentDeviation?: number | null;
  wpm: number;
  accuracy: number;
  consistency?: number;
  timeSpentSec?: number;
  textLength?: number;
  mistakes?: number;
  corrections?: number;
}): RatingUpdate {
  const previousRating = clamp(
    Math.round(safeNumber(input.currentRating, DEFAULT_RATING)),
    MIN_RATING,
    MAX_RATING
  );

  const previousDeviation = clamp(
    Math.round(safeNumber(input.currentDeviation, DEFAULT_RATING_DEVIATION)),
    MIN_DEVIATION,
    MAX_DEVIATION
  );

  const { sessionRating, weight } = computeSessionRating({
    wpm: input.wpm,
    accuracy: input.accuracy,
    consistency: input.consistency,
    timeSpentSec: input.timeSpentSec,
    textLength: input.textLength,
    mistakes: input.mistakes,
    corrections: input.corrections,
  });

  // Higher deviation => faster adaptation (newer players).
  const deviationFactor = clamp(previousDeviation / MAX_DEVIATION, 0.25, 1);

  // Base learning rate tuned to feel responsive without being noisy.
  // Harder at higher ratings to make top tiers feel earned.
  const baseK = 0.14;
  const ratingFactor = clamp(1 - 0.45 * Math.pow(previousRating / MAX_RATING, 1.6), 0.45, 1);
  const k = clamp(baseK * ratingFactor * deviationFactor * weight, 0, 0.18);

  const rawNext = previousRating + k * (sessionRating - previousRating);
  const nextRating = clamp(Math.round(rawNext), MIN_RATING, MAX_RATING);

  // Deviation shrinks with weighted sessions; never below MIN_DEVIATION.
  const nextDeviation = clamp(
    Math.round(previousDeviation * (1 - 0.045 * weight)),
    MIN_DEVIATION,
    MAX_DEVIATION
  );

  return {
    previousRating,
    previousDeviation,
    sessionRating,
    nextRating,
    nextDeviation,
    delta: nextRating - previousRating,
  };
}

const TIERS: Array<{ tier: RankTier; min: number; max: number | null }> = [
  { tier: "Prime",     min: 0,    max: 850  },
  { tier: "Silver",    min: 850,  max: 1150 },
  { tier: "Gold",      min: 1150, max: 1500 },
  { tier: "Platinum",  min: 1500, max: 1850 },
  { tier: "Diamond",   min: 1850, max: 2200 },
  { tier: "Legendary", min: 2200, max: null },
];

export function getRankInfo(ratingInput: number): RankInfo {
  const rating = clamp(Math.round(safeNumber(ratingInput, DEFAULT_RATING)), MIN_RATING, MAX_RATING);

  const tierRow =
    TIERS.find((t) => rating >= t.min && (t.max === null || rating < t.max)) ?? TIERS[0];

  const tierMin = tierRow.min;
  const tierMax = tierRow.max;

  if (tierMax === null) {
    return {
      rating,
      tier: tierRow.tier,
      tierMinRating: tierMin,
      tierMaxRating: null,
      progressPct: 100,
      nextAtRating: null,
    };
  }

  const tierRange = Math.max(1, tierMax - tierMin);
  const within = clamp(rating - tierMin, 0, tierRange);
  const progressPct = clamp((within / tierRange) * 100, 0, 100);

  return {
    rating,
    tier: tierRow.tier,
    tierMinRating: tierMin,
    tierMaxRating: tierMax,
    progressPct,
    nextAtRating: tierMax,
  };
}

export function estimateInitialRatingFromLongTermStats(input: {
  averageWPM?: number | null;
  averageAccuracy?: number | null;
  averageConsistency?: number | null;
  totalTimeTypedSec?: number | null;
}): { rating: number; deviation: number } {
  const averageWPM = clamp(safeNumber(input.averageWPM, 0), 0, 500);
  const averageAccuracy = clamp(safeNumber(input.averageAccuracy, 0), 0, 100);
  const averageConsistency = clamp(safeNumber(input.averageConsistency, 0), 0, 100);
  const totalTimeTypedSec = clamp(Math.floor(safeNumber(input.totalTimeTypedSec, 0)), 0, 365 * 24 * 3600);

  const minutes = totalTimeTypedSec / 60;

  const { sessionRating } = computeSessionRating({
    wpm: averageWPM,
    accuracy: averageAccuracy,
    consistency: averageConsistency,
    timeSpentSec: 120,
  });

  // Trust increases with time typed; approaches 1 after a couple of hours.
  const trust = clamp(1 - Math.exp(-minutes / 30), 0, 1);
  const rating = clamp(
    Math.round(DEFAULT_RATING * (1 - trust) + sessionRating * trust),
    MIN_RATING,
    MAX_RATING
  );

  // Deviation drops quickly with practice time.
  const deviation = clamp(
    Math.round(MIN_DEVIATION + (MAX_DEVIATION - MIN_DEVIATION) * Math.exp(-minutes / 60)),
    MIN_DEVIATION,
    MAX_DEVIATION
  );

  return { rating, deviation };
}
