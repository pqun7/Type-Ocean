import type { DailyChallenge } from "@/features/level/types/level";
import { CHALLENGE_TYPE_WEIGHTS } from "../constants/level";
import { getChallengeXP } from "@/features/level/utils/xpMath";

// Difficulty scaling factors
const WPM_SCALE_FACTOR = 0.5;
const ACCURACY_SCALE_FACTOR = 0.15;
const LENGTH_SCALE_FACTOR = 4;
const TIME_SCALE_FACTOR = 12;

// Challenge caps (to prevent impossible challenges)
const MAX_WPM = 100;
const MAX_ACCURACY = 100;
const MAX_LENGTH = 2000;
const MAX_TIME = 1800; // 30 minutes
const MIN_WPM = 50;
const MIN_LENGTH = 300;
const MIN_TIME = 300; // 5 minutes

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
  userLevel: number
): Promise<DailyChallenge> => {
  const today = new Date().toISOString().split("T")[0];

  // Non-linear difficulty scaling with diminishing returns
  const challengeConfig = {
    baseWPM: Math.min(
      MAX_WPM,
      MIN_WPM + Math.log1p(userLevel) * WPM_SCALE_FACTOR * 20
    ),
    baseAccuracy: Math.min(
      MAX_ACCURACY,
      85 + Math.log1p(userLevel) * ACCURACY_SCALE_FACTOR
    ),
    baseLength: Math.min(
      MAX_LENGTH,
      MIN_LENGTH + Math.sqrt(userLevel) * LENGTH_SCALE_FACTOR
    ),
    baseTime: Math.min(
      MAX_TIME,
      MIN_TIME + Math.pow(userLevel, 0.7) * TIME_SCALE_FACTOR
    ),
  };

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
        wpm: Math.min(
          MAX_WPM,
          Math.round(
            challengeConfig.baseWPM * (1.1 + Math.random() * 0.15) // 10-25% above base
          )
        ),
        accuracy: Math.min(
          MAX_ACCURACY,
          Math.round(
            challengeConfig.baseAccuracy * (1.02 + Math.random() * 0.03) // 2-5% above base
          )
        ),
      },
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.speedCombo,
    },
    // Marathon - longer typing sessions
    {
      id: generateChallengeId(userId, "marathon"),
      type: "marathon" as const,
      target: Math.min(
        MAX_LENGTH,
        Math.round(
          challengeConfig.baseLength * (1.2 + Math.random() * 0.3) // 20-50% above base
        )
      ),
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.marathon,
    },
    // Time Attack - focused bursts
    {
      id: generateChallengeId(userId, "timeAttack"),
      type: "timeAttack" as const,
      target: Math.min(
        MAX_TIME,
        Math.round(
          challengeConfig.baseTime * (0.7 + Math.random() * 0.3) // 70-100% of base
        )
      ),
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.timeAttack,
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

  // Add progress tracking
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
      return typeof challenge.target === "number";

    case "speedCombo":
      return (
        typeof challenge.target === "object" &&
        challenge.target !== null &&
        "wpm" in challenge.target &&
        "accuracy" in challenge.target &&
        typeof challenge.target.wpm === "number" &&
        typeof challenge.target.accuracy === "number"
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