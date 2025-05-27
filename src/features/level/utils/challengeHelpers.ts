// challengeHelpers.ts
import { DailyChallenge } from "@/features/level/types/level";
import { CHALLENGE_TYPE_WEIGHTS } from "../constants/level";
import { connection } from "next/server";
import { getChallengeXP } from "@/features/level/utils/xpMath";

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
  await connection();
  const today = new Date().toISOString().split("T")[0];

  // Base configuration with level scaling
  const challengeConfig = {
    baseWPM: Math.min(70, 50 + userLevel * 0.8),
    baseAccuracy: Math.min(100, 85 + userLevel * 0.2),
    baseLength: Math.min(800, 300 + userLevel * 3),
    baseTime: Math.min(1800, 600 + userLevel * 15),
  };

  /**
   * Generates unique challenge ID with timestamp and random component
   * @param userId - User ID for uniqueness
   * @param type - Challenge type identifier
   * @returns Formatted challenge ID string
   */
  const generateChallengeId = (userId: string, type: string) => {
    const datePart = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `${type}-${userId}-${datePart}-${randomPart}`;
  };

  // Challenge type definitions with weighted probabilities
  const challengeTypes = [
    // Speed Combo: Requires both WPM and accuracy targets
    {
      id: generateChallengeId(userId, "speedCombo"),
      type: "speedCombo" as const,
      target: {
        wpm: Math.round(challengeConfig.baseWPM * (1.15 + Math.random() * 0.15)),
        accuracy: Math.round(challengeConfig.baseAccuracy * (1.05 + Math.random() * 0.05)),
      },
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.speedCombo,
    },
    // Marathon: Long-form typing endurance challenge
    {
      id: generateChallengeId(userId, "marathon"),
      type: "marathon" as const,
      target: Math.round(challengeConfig.baseLength * (1.3 + Math.random() * 0.4)),
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.marathon,
    },
    // Time Attack: Speed-focused timed challenge
    {
      id: generateChallengeId(userId, "timeAttack"),
      type: "timeAttack" as const,
      target: Math.round(challengeConfig.baseTime * (0.8 + Math.random() * 0.4)),
      xp: getChallengeXP(userLevel),
      status: 0,
      weight: CHALLENGE_TYPE_WEIGHTS.timeAttack,
    },
  ];

  // Weighted random selection algorithm
  const totalWeight = challengeTypes.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;

  const selectedChallenge = challengeTypes.find((challenge) => {
    random -= challenge.weight;
    return random <= 0;
  })!;

  // Base challenge structure with type-specific data
  const baseChallenge = {
    ...selectedChallenge,
    date: today,
    difficulty: userLevel,
    status: 0 as 0,
  };

  // Add type-specific progress tracking data
  switch (selectedChallenge.type) {
    case "marathon":
      return { ...baseChallenge, data: { charactersTyped: 0 } };
    case "timeAttack":
      return { ...baseChallenge, data: { timeSpent: 0 } };
    case "speedCombo":
      return { ...baseChallenge, data: {} }; // No additional data required
    default:
      return baseChallenge;
  }
};

/**
 * Validates challenge object structure
 * @param challenge - Challenge object to validate
 * @returns Boolean indicating valid challenge structure
 */
export const validateChallenge = (challenge: DailyChallenge): boolean => {
  return (
    (challenge.date &&
      challenge.xp > 0 &&
      challenge.type === "marathon" &&
      typeof challenge.target === "number") ||
    (challenge.type === "timeAttack" && typeof challenge.target === "number") ||
    (challenge.type === "speedCombo" &&
      typeof challenge.target === "object" &&
      "wpm" in challenge.target &&
      "accuracy" in challenge.target)
  );
};

/**
 * Calculates challenge progress status
 * @param challenge - Challenge definition
 * @param progress - Current progress data
 * @returns Status code: 0 = Not started, 1 = In progress, 2 = Completed
 */
export const calculateChallengeStatus = (
  challenge: DailyChallenge,
  progress: any
): 0 | 1 | 2 => {
  if (isChallengeCompleted(challenge, progress)) return 2;
  return Object.values(progress).some((v: any) => v > 0) ? 1 : 0;
};

/**
 * Determines if challenge completion criteria are met
 * @param challenge - Challenge definition
 * @param progress - Current progress data
 * @returns Boolean indicating completion status
 */
export const isChallengeCompleted = (
  challenge: DailyChallenge,
  progress: any
): boolean => {
  switch (challenge.type) {
    case "speedCombo":
      return (
        typeof progress === "object" &&
        typeof challenge.target === "object" &&
        progress.wpm >= challenge.target.wpm &&
        progress.accuracy >= challenge.target.accuracy
      );

    case "marathon":
      return (
        typeof progress === "object" &&
        typeof challenge.target === "number" &&
        progress.charactersTyped >= challenge.target
      );

    case "timeAttack":
      return (
        typeof progress === "object" &&
        typeof challenge.target === "number" &&
        progress.timeSpent >= challenge.target
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
  progress: any
): string => {
  switch (challenge.type) {
    case "speedCombo":
      return `WPM: ${progress.wpm} / Accuracy: ${progress.accuracy}`;
    case "marathon":
      return `Characters Typed: ${progress.charactersTyped}`;
    case "timeAttack":
      return `Time Spent: ${progress.timeSpent}`;
    default:
      return "";
  }
};