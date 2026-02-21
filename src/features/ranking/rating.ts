export type RankTier =
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Diamond"
  | "Master"
  | "Grandmaster";

export type RankDivision = "III" | "II" | "I";

export type RankInfo = {
  rating: number;
  tier: RankTier;
  division: RankDivision;
  divisionMinRating: number;
  divisionMaxRating: number | null;
  progressPct: number; // 0..100 within current division
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

/**
 * Converts one typing session into an approximate skill rating on a 0..3000 scale.
 * This is not PvP MMR; it is a performance index that mixes speed + accuracy + consistency.
 */
export function computeSessionRating(input: {
  wpm: number;
  accuracy: number;
  consistency?: number;
  timeSpentSec?: number;
}): { sessionRating: number; weight: number } {
  const wpm = clamp(safeNumber(input.wpm, 0), 0, 500);
  const accuracy = clamp(safeNumber(input.accuracy, 0), 0, 100);
  const consistency = clamp(safeNumber(input.consistency, 0), 0, 100);
  const timeSpentSec = clamp(Math.floor(safeNumber(input.timeSpentSec, 60)), 1, 7200);

  // Time weighting: reach full weight around ~2 minutes.
  const minutes = timeSpentSec / 60;
  const timeFactorRaw = Math.sqrt(minutes / 2);
  const weight = clamp(timeFactorRaw, 0.25, 1);

  // Speed saturates: early improvements matter more than extreme WPM.
  const wpmScore = clamp(1 - Math.exp(-wpm / 80), 0, 1);

  // Accuracy is intentionally steep: high accuracy is rewarded.
  const accScore = Math.pow(clamp(accuracy / 100, 0, 1), 2.0);

  // Consistency is useful but optional and lower-weighted.
  const consScore = Math.pow(clamp(consistency / 100, 0, 1), 1.5);

  const composite = clamp(0.7 * wpmScore + 0.2 * accScore + 0.1 * consScore, 0, 1);
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
  });

  // Higher deviation => faster adaptation (newer players).
  const deviationFactor = clamp(previousDeviation / MAX_DEVIATION, 0.25, 1);

  // Base learning rate tuned to feel responsive without being noisy.
  const baseK = 0.14;
  const k = clamp(baseK * deviationFactor * weight, 0.01, 0.22);

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
  { tier: "Bronze", min: 0, max: 900 },
  { tier: "Silver", min: 900, max: 1200 },
  { tier: "Gold", min: 1200, max: 1500 },
  { tier: "Platinum", min: 1500, max: 1800 },
  { tier: "Diamond", min: 1800, max: 2100 },
  { tier: "Master", min: 2100, max: 2400 },
  { tier: "Grandmaster", min: 2400, max: null },
];

export function getRankInfo(ratingInput: number): RankInfo {
  const rating = clamp(Math.round(safeNumber(ratingInput, DEFAULT_RATING)), MIN_RATING, MAX_RATING);

  const tierRow =
    TIERS.find((t) => rating >= t.min && (t.max === null || rating < t.max)) ?? TIERS[0];

  const tierMin = tierRow.min;
  const tierMax = tierRow.max;

  // Grandmaster has no divisions above it.
  if (tierMax === null) {
    return {
      rating,
      tier: tierRow.tier,
      division: "I",
      divisionMinRating: tierMin,
      divisionMaxRating: null,
      progressPct: 100,
      nextAtRating: null,
    };
  }

  const tierRange = Math.max(1, tierMax - tierMin);
  const divisionSize = Math.max(1, Math.floor(tierRange / 3));

  const offset = clamp(rating - tierMin, 0, tierRange - 1);
  const divisionIndex = clamp(Math.floor(offset / divisionSize), 0, 2); // 0..2

  const division: RankDivision = divisionIndex === 0 ? "III" : divisionIndex === 1 ? "II" : "I";
  const divisionMinRating = tierMin + divisionIndex * divisionSize;
  const divisionMaxRating = divisionIndex === 2 ? tierMax : tierMin + (divisionIndex + 1) * divisionSize;

  const within = clamp(rating - divisionMinRating, 0, Math.max(1, divisionMaxRating - divisionMinRating));
  const progressPct = clamp((within / Math.max(1, divisionMaxRating - divisionMinRating)) * 100, 0, 100);

  const nextAtRating = divisionMaxRating;

  return {
    rating,
    tier: tierRow.tier,
    division,
    divisionMinRating,
    divisionMaxRating,
    progressPct,
    nextAtRating,
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
