import {
  BASE_XP,
  EXPONENTIAL_GROWTH_LEVEL,
  LINEAR_GROWTH_INCREMENT,
  LINEAR_GROWTH_END_LEVEL,
  EXP_GROWTH_END_LEVEL,
  MAX_XP_MULTIPLIER,
  
} from "@/features/level/constants/level";

export const calculateNextLevelXP = (level: number): number => {
  if (level <= EXPONENTIAL_GROWTH_LEVEL) {
    return Math.round(BASE_XP * Math.pow(1.7, level - 1));
  } else {
    const xpAtThreshold = BASE_XP * Math.pow(1.7, EXPONENTIAL_GROWTH_LEVEL - 1);
    return Math.round(
      xpAtThreshold +
        LINEAR_GROWTH_INCREMENT * (level - EXPONENTIAL_GROWTH_LEVEL)
    );
  }
};

export function getChallengeXP(level: number): number {
  if (level < 1) return 0;
  if (level > LINEAR_GROWTH_END_LEVEL) return BASE_XP * MAX_XP_MULTIPLIER;
  if (level <= EXP_GROWTH_END_LEVEL) {
    const growthFactor = Math.pow(10, 1 / (EXP_GROWTH_END_LEVEL - 1));
    const percentage = 10 * Math.pow(growthFactor, level - 1);
    return Math.round((percentage / 100) * BASE_XP);
  }
  // مرحلة النمو الخطّي (المستويات 51-100)
  const linearIncrement =
    ((MAX_XP_MULTIPLIER - 1) * BASE_XP) /
    (LINEAR_GROWTH_END_LEVEL - EXP_GROWTH_END_LEVEL);
  return Math.round(BASE_XP + (level - EXP_GROWTH_END_LEVEL) * linearIncrement);
}