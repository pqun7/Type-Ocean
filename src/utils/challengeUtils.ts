
import { DailyChallenge } from "@/types/level";

export const calculateChallengeStatus = (
  challenge: DailyChallenge,
  progress: any
): 0 | 1 | 2 => {
  // 0: لم يبدأ، 1: قيد التقدم، 2: مكتمل
  if (isChallengeCompleted(challenge, progress)) return 2;
  return Object.keys(progress).length > 0 ? 1 : 0;
};

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
