import type { DailyChallenge } from "@/features/level/types/level";
import { CHALLENGE_TYPE_WEIGHTS } from "../constants/level";
import { getChallengeXP } from "@/features/level/utils/xpMath";

// Challenge caps (hard safety limits)
// NOTE: These are absolute clamps. We additionally apply per-user realism clamps.
const MAX_WPM = 220;
const MAX_ACCURACY = 100;
const MAX_LENGTH = 8000;
const MAX_TIME = 1800; // 30 minutes

const MIN_WPM = 15;
const MIN_ACCURACY = 60;
const MIN_LENGTH = 150;
const MIN_TIME = 300; // 5 minutes

export type ChallengeGenerationStats = {
  averageWPM?: number;
  averageAccuracy?: number;
  bestWPM?: number;
  bestAccuracy?: number;
  totalSessions?: number;
  totalTimeTyped?: number; // seconds
  totalCharactersTyped?: number;
  lastUpdated?: string; // ISO timestamp of last session stats update
  lastOutcome?: {
    date: string;
    type: DailyChallenge["type"];
    status: DailyChallenge["status"];
    attempts?: number;
    streak?: number;
  };
  streak?: number;
};

type ChallengeMetrics = {
  baselineWpm: number;
  baselineAcc: number;
  avgSessionSeconds: number;
  charsPerMinute: number;
  baselineCharsPerSession: number;
  maxTimeForUser: number;
  maxWpmForUser: number;
  maxAccForUser: number;
  maxCharsForUser: number;
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function roundInt(n: number): number {
  return Math.round(n);
}

function safeNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildMetrics(userLevel: number, stats?: ChallengeGenerationStats): ChallengeMetrics {
  const totalSessions = Math.max(0, Math.floor(safeNum(stats?.totalSessions, 0)));
  const totalTimeTyped = Math.max(0, safeNum(stats?.totalTimeTyped, 0));
  const totalCharactersTyped = Math.max(0, safeNum(stats?.totalCharactersTyped, 0));

  // If we have enough history, trust it; otherwise fall back to level-based priors.
  const hasHistory = totalSessions >= 5 && (stats?.averageWPM || stats?.averageAccuracy);

  const avgWpm = clamp(safeNum(stats?.averageWPM, 0), 0, MAX_WPM);
  const bestWpm = clamp(safeNum(stats?.bestWPM, 0), 0, MAX_WPM);
  const avgAcc = clamp(safeNum(stats?.averageAccuracy, 0), 0, MAX_ACCURACY);
  const bestAcc = clamp(safeNum(stats?.bestAccuracy, 0), 0, MAX_ACCURACY);

  // Level priors (non-linear, gentle). Keep them conservative for beginners.
  const wpmFromLevel = clamp(18 + Math.log1p(userLevel) * 9 + Math.sqrt(userLevel) * 0.6, MIN_WPM, 120);
  const accFromLevel = clamp(82 + Math.log1p(userLevel) * 1.2, 75, 98);

  // Robust baseline: blend average + capped best to avoid spike-based impossible targets.
  const cappedBestWpm = Math.min(bestWpm, avgWpm > 0 ? avgWpm * 1.35 : bestWpm);
  const cappedBestAcc = Math.min(bestAcc, avgAcc > 0 ? avgAcc + 3 : bestAcc);

  const baselineWpm = hasHistory
    ? clamp(avgWpm * 0.72 + cappedBestWpm * 0.28, MIN_WPM, MAX_WPM)
    : wpmFromLevel;

  const baselineAcc = hasHistory
    ? clamp(avgAcc * 0.82 + cappedBestAcc * 0.18, MIN_ACCURACY, MAX_ACCURACY)
    : accFromLevel;

  const avgSessionSecondsRaw = totalSessions > 0 ? totalTimeTyped / totalSessions : 0;
  const avgSessionSeconds = hasHistory
    ? clamp(avgSessionSecondsRaw, 45, 1200)
    : clamp(90 + Math.log1p(userLevel) * 18, 60, 600);

  // Typing speed -> chars per minute. Roughly 5.2 chars/word (letters+space).
  const charsPerMinute = clamp(baselineWpm * 5.2, 50, 2500);

  const charsPerSessionFromHistory = totalSessions > 0 ? totalCharactersTyped / totalSessions : 0;
  const charsPerSessionFromWpm = (charsPerMinute * avgSessionSeconds) / 60;
  const baselineCharsPerSession = hasHistory
    ? clamp(charsPerSessionFromHistory || charsPerSessionFromWpm, 80, MAX_LENGTH)
    : clamp(charsPerSessionFromWpm, 80, MAX_LENGTH);

  // Per-user max clamps (protect against unrealistic jumps)
  const maxTimeForUser = clamp(
    // TimeAttack is meant to keep the user longer, but still bounded.
    Math.max(
      MIN_TIME,
      avgSessionSeconds * 3.2,
      600 + Math.log1p(userLevel) * 120
    ),
    MIN_TIME,
    MAX_TIME
  );

  const maxWpmForUser = clamp(Math.max(35, baselineWpm * 1.28 + 6), MIN_WPM, MAX_WPM);
  const maxAccForUser = clamp(Math.max(70, baselineAcc + 5), MIN_ACCURACY, MAX_ACCURACY);
  const maxCharsForUser = clamp(
    Math.max(MIN_LENGTH, baselineCharsPerSession * 2.2, (charsPerMinute * maxTimeForUser) / 60),
    MIN_LENGTH,
    MAX_LENGTH
  );

  return {
    baselineWpm,
    baselineAcc,
    avgSessionSeconds,
    charsPerMinute,
    baselineCharsPerSession,
    maxTimeForUser,
    maxWpmForUser,
    maxAccForUser,
    maxCharsForUser,
  };
}

function hoursSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function sanitizeChallenge(challenge: DailyChallenge, metrics: ChallengeMetrics): DailyChallenge {
  const common = {
    ...challenge,
    xp: Math.max(1, roundInt(challenge.xp)),
    difficulty: Math.max(1, roundInt(challenge.difficulty)),
    status: 0 as const,
  };

  if (challenge.type === "speedCombo") {
    const t = challenge.target as { wpm: number; accuracy: number };
    const wpm = clamp(roundInt(safeNum(t?.wpm, metrics.baselineWpm)), MIN_WPM, metrics.maxWpmForUser);
    const acc = clamp(roundInt(safeNum(t?.accuracy, metrics.baselineAcc)), MIN_ACCURACY, metrics.maxAccForUser);

    return {
      ...common,
      target: { wpm, accuracy: acc },
      data: typeof common.data === "object" && common.data !== null ? common.data : {},
    };
  }

  if (challenge.type === "marathon") {
    const target = clamp(roundInt(safeNum(challenge.target, metrics.baselineCharsPerSession)), MIN_LENGTH, metrics.maxCharsForUser);
    return {
      ...common,
      target,
      data: { ...(typeof common.data === "object" && common.data !== null ? common.data : {}), charactersTyped: 0 },
    };
  }

  if (challenge.type === "timeAttack") {
    const target = clamp(roundInt(safeNum(challenge.target, metrics.avgSessionSeconds)), MIN_TIME, metrics.maxTimeForUser);
    return {
      ...common,
      target,
      data: { ...(typeof common.data === "object" && common.data !== null ? common.data : {}), timeSpent: 0 },
    };
  }

  return common;
}

// Define proper types for progress objects
interface SpeedComboProgress {
  wpm?: number;
  accuracy?: number;
  completed?: boolean;
}

interface MarathonProgress {
  charactersTyped?: number;
  completed?: boolean;
}

interface TimeAttackProgress {
  timeSpent?: number;
  completed?: boolean;
}

type ChallengeProgress = SpeedComboProgress | MarathonProgress | TimeAttackProgress;

/**
 * Generates a personalized daily challenge based on user level
 * @param userId - User ID for challenge ownership
 * @param userLevel - Current user level for difficulty scaling
 * @returns Promise resolving to generated DailyChallenge object
 */
export const generateDailyChallenge = async (
  userId: string,
  userLevel: number,
  stats?: ChallengeGenerationStats
): Promise<DailyChallenge> => {
  const today = new Date().toISOString().split("T")[0];

  // Metrics based on the player's real performance; keeps challenges "level+" but not impossible.
  const metrics = buildMetrics(userLevel, stats);

  // Adaptive tuning (variety + engagement)
  const last = stats?.lastOutcome;
  const inactivityHours = hoursSince(stats?.lastUpdated);
  const inactive = typeof inactivityHours === "number" && inactivityHours > 36;

  const weightMultiplier: Record<DailyChallenge["type"], number> = {
    speedCombo: 1,
    marathon: 1,
    timeAttack: 1,
  };

  // Avoid repeating the same type as yesterday's completed challenge.
  if (last?.status === 1 && last.type) {
    weightMultiplier[last.type] *= 0.55;
  }

  // If the player needed many attempts previously, de-emphasize speedCombo a bit.
  if (last?.status === 1 && last.type === "speedCombo" && typeof last.attempts === "number" && last.attempts >= 6) {
    weightMultiplier.speedCombo *= 0.75;
    weightMultiplier.marathon *= 1.15;
  }

  // Engagement lever: if user is inactive, bias to timeAttack (site time goal), but keep targets clamped.
  if (inactive) {
    weightMultiplier.timeAttack *= 1.35;
    weightMultiplier.speedCombo *= 0.9;
  }

  // Streak reward: small difficulty lift within clamps
  const streak = Math.max(0, Math.floor(safeNum(last?.streak ?? stats?.streak, 0)));
  const streakBoost = clamp(Math.log1p(streak) * 0.015, 0, 0.06); // up to ~6%

  const speedWpmMult = { min: 1.06 + streakBoost, max: 1.16 + streakBoost };
  const marathonMult = { min: 1.15 + streakBoost, max: 1.38 + streakBoost };
  const timeMult = inactive
    ? { min: 2.1 + streakBoost, max: 2.75 + streakBoost }
    : { min: 1.8 + streakBoost, max: 2.6 + streakBoost };

  const generateChallengeId = (userId: string, type: string) => {
    const datePart = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `${type}-${userId}-${datePart}-${randomPart}`;
  };

  // Challenge types with scaled difficulty and fun variations
  const challengeTypes = [
    // Speed Combo - requires both WPM and accuracy
    {
      id: generateChallengeId(userId, "speedCombo"),
      type: "speedCombo" as const,
      target: {
        // Stretch WPM slightly above baseline; clamp to avoid unrealistic spikes.
        wpm: clamp(
          roundInt(metrics.baselineWpm * rand(speedWpmMult.min, speedWpmMult.max) + Math.log1p(userLevel) * 0.6),
          MIN_WPM,
          metrics.maxWpmForUser
        ),
        // Accuracy: small improvement over baseline; harder if baseline is already high.
        accuracy: clamp(
          roundInt(
            Math.max(
              metrics.baselineAcc + (metrics.baselineAcc >= 95 ? 0.2 : 0.8),
              metrics.baselineAcc +
                (metrics.baselineAcc >= 95 ? rand(0.5, 1.8) : rand(1.2, 3.2)) -
                // Trade-off: higher WPM stretch reduces accuracy stretch a bit.
                (metrics.baselineWpm > 0 ? rand(0, 1.2) * (metrics.baselineWpm / 120) : 0)
            )
          ),
          MIN_ACCURACY,
          metrics.maxAccForUser
        ),
      },
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.speedCombo * weightMultiplier.speedCombo,
    },
    // Marathon - longer typing sessions
    {
      id: generateChallengeId(userId, "marathon"),
      type: "marathon" as const,
      target: clamp(
        roundInt(metrics.baselineCharsPerSession * rand(marathonMult.min, marathonMult.max) + Math.sqrt(userLevel) * 12),
        MIN_LENGTH,
        metrics.maxCharsForUser
      ),
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.marathon * weightMultiplier.marathon,
    },
    // Time Attack - focused bursts
    {
      id: generateChallengeId(userId, "timeAttack"),
      type: "timeAttack" as const,
      // Special: Time Attack is intentionally designed to keep the user longer.
      // Still bounded by per-user realism clamps to avoid impossible targets.
      target: clamp(
        roundInt(Math.max(MIN_TIME, metrics.avgSessionSeconds) * rand(timeMult.min, timeMult.max) + Math.log1p(userLevel) * 10),
        MIN_TIME,
        metrics.maxTimeForUser
      ),
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.timeAttack * weightMultiplier.timeAttack,
    },
  ];

  // Weighted random selection
  const totalWeight = challengeTypes.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;

  const selectedChallenge = challengeTypes.find((challenge) => {
    random -= challenge.weight;
    return random <= 0;
  })!;

  // Strip internal field 'weight' before constructing the public challenge object
  const { weight: _ignoredWeight, ...selectedWithoutWeight } = selectedChallenge as any;

  // Base challenge structure without leaking 'weight'
  const baseChallenge = {
    ...selectedWithoutWeight,
    date: today,
    difficulty: userLevel,
    status: 0,
  };

  // Add progress tracking + strict sanitization (prevents unrealistic targets)
  const withProgress = (() => {
    switch (selectedChallenge.type) {
      case "marathon":
        return { ...baseChallenge, data: { charactersTyped: 0 } };
      case "timeAttack":
        return { ...baseChallenge, data: { timeSpent: 0 } };
      case "speedCombo":
        return { ...baseChallenge, data: {} };
      default:
        return baseChallenge as DailyChallenge;
    }
  })();

  const sanitized = sanitizeChallenge(withProgress as DailyChallenge, metrics);
  return validateChallenge(sanitized) ? sanitized : sanitizeChallenge({
    id: (withProgress as DailyChallenge).id,
    date: today,
    type: "speedCombo",
    target: { wpm: clamp(roundInt(metrics.baselineWpm), MIN_WPM, metrics.maxWpmForUser), accuracy: clamp(roundInt(metrics.baselineAcc), MIN_ACCURACY, metrics.maxAccForUser) },
    xp: getChallengeXP(userLevel),
    difficulty: userLevel,
    status: 0,
    data: {},
  }, metrics);
};

/**
 * Validates challenge object structure
 * @param challenge - Challenge object to validate
 * @returns Boolean indicating valid challenge structure
 */
export const validateChallenge = (challenge: DailyChallenge): boolean => {
  // Check basic required fields first
  if (!challenge.date || challenge.xp <= 0) {
    return false;
  }

  // Then validate type-specific target structures
  switch (challenge.type) {
    case "marathon":
    case "timeAttack":
      if (typeof challenge.target !== "number") return false;
      if (!Number.isFinite(challenge.target)) return false;
      if (challenge.type === "marathon") return challenge.target >= MIN_LENGTH && challenge.target <= MAX_LENGTH;
      return challenge.target >= MIN_TIME && challenge.target <= MAX_TIME;

    case "speedCombo":
      return (
        typeof challenge.target === "object" &&
        challenge.target !== null &&
        "wpm" in challenge.target &&
        "accuracy" in challenge.target &&
        typeof challenge.target.wpm === "number" &&
        typeof challenge.target.accuracy === "number" &&
        Number.isFinite(challenge.target.wpm) &&
        Number.isFinite(challenge.target.accuracy) &&
        challenge.target.wpm >= MIN_WPM &&
        challenge.target.wpm <= MAX_WPM &&
        challenge.target.accuracy >= MIN_ACCURACY &&
        challenge.target.accuracy <= MAX_ACCURACY
      );

    default:
      return false;
  }
};

/**
 * Calculates challenge progress status
 * @param challenge - Challenge definition
 * @param progress - Current progress data
 * @returns Status code: 0 = Not started, 1 = Completed, -1 = In progress
 */
export const calculateChallengeStatus = (
  challenge: DailyChallenge,
  progress: ChallengeProgress
): 0 | 1 | -1 => {
  if (isChallengeCompleted(challenge, progress)) return 1; // Completed
  
  // Check if any progress values exist
  const hasProgress = Object.values(progress).some((v) => {
    if (typeof v === 'number') return v > 0;
    return false;
  });
  
  return hasProgress ? -1 : 0; // In progress or not started
};

/**
 * Determines if challenge completion criteria are met
 * @param challenge - Challenge definition
 * @param progress - Current progress data
 * @returns Boolean indicating completion status
 */
export const isChallengeCompleted = (
  challenge: DailyChallenge,
  progress: ChallengeProgress
): boolean => {
  switch (challenge.type) {
    case "speedCombo":
      const speedTarget = challenge.target as { wpm: number; accuracy: number };
      const speedProgress = progress as SpeedComboProgress;
      return (
        typeof speedProgress.wpm === 'number' &&
        typeof speedProgress.accuracy === 'number' &&
        speedProgress.wpm >= speedTarget.wpm &&
        speedProgress.accuracy >= speedTarget.accuracy
      );

    case "marathon":
      const marathonTarget = challenge.target as number;
      const marathonProgress = progress as MarathonProgress;
      return (
        typeof marathonProgress.charactersTyped === 'number' &&
        marathonProgress.charactersTyped >= marathonTarget
      );

    case "timeAttack":
      const timeTarget = challenge.target as number;
      const timeProgress = progress as TimeAttackProgress;
      return (
        typeof timeProgress.timeSpent === 'number' &&
        timeProgress.timeSpent >= timeTarget
      );

    default:
      return false;
  }
};

/**
 * Generates human-readable progress summary
 * @param challenge - Challenge definition
 * @param progress - Current progress data
 * @returns Formatted progress string
 */
export const getChallengeStatusText = (
  challenge: DailyChallenge,
  progress: ChallengeProgress
): string => {
  switch (challenge.type) {
    case "speedCombo":
      const speedProgress = progress as SpeedComboProgress;
      return `WPM: ${speedProgress.wpm ?? 0} / Accuracy: ${speedProgress.accuracy ?? 0}%`;
    case "marathon":
      const marathonProgress = progress as MarathonProgress;
      return `Characters Typed: ${marathonProgress.charactersTyped ?? 0}`;
    case "timeAttack":
      const timeProgress = progress as TimeAttackProgress;
      return `Time Spent: ${timeProgress.timeSpent ?? 0}s`;
    default:
      return "No progress data";
  }
};