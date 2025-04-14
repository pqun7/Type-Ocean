import { DailyChallenge, SessionData } from "@/types/level";
import {
  BASE_XP,
  EXPONENTIAL_GROWTH_LEVEL,
  LINEAR_GROWTH_INCREMENT,
  DAILY_CHALLENGE_BASE_XP,
  LINEAR_GROWTH_END_LEVEL,
  EXP_GROWTH_END_LEVEL,
  MAX_XP_MULTIPLIER,
} from "../constants/level";
import { connection } from 'next/server';

// XP Calculation Helper
export const calculateNextLevelXP = (level: number): number => {
  if (level <= EXPONENTIAL_GROWTH_LEVEL) {
    return Math.round(BASE_XP * Math.pow(1.7, level - 1));
  } else {
    const xpAtThreshold = BASE_XP * Math.pow(1.7, EXPONENTIAL_GROWTH_LEVEL - 1);
    return Math.round(xpAtThreshold + LINEAR_GROWTH_INCREMENT * (level - EXPONENTIAL_GROWTH_LEVEL));
  }
};

export const generateDailyChallenge = async (level: number): Promise<DailyChallenge> => {
  await connection();

  const today = new Date().toISOString().split('T')[0];
  
  const baseTargets = {
    wpm: Math.min(80, 50 + level * 0.5),      
    accuracy: Math.min(100, 90 + level * 0.1),  // الحد الأقصى للدقة 95%
    length: Math.min(500, 300 + level * 2),    // الحد الأقصى للطول 500 كلمة
  };
  

  const challengeTypes: DailyChallenge[] = [
    {
      type: "wpm",
      target: Math.round(baseTargets.wpm * (1 + Math.random() * 0.3)),
      xp: DAILY_CHALLENGE_BASE_XP * 1.2,
    },
    {
      type: "accuracy",
      target: Math.min(
        100,
        Math.round(baseTargets.accuracy * (1 + Math.random() * 0.15))
      ),
      xp: DAILY_CHALLENGE_BASE_XP * 1.1,
    },
    {
      type: "length",
      target: Math.round(baseTargets.length * (1 + Math.random() * 0.5)),
      xp: DAILY_CHALLENGE_BASE_XP * 1.5,
    },
  ];

  const selectedChallenge = challengeTypes[Math.floor(Math.random() * challengeTypes.length)];

  return {
    ...selectedChallenge,
    date: today,
  };
};


export const checkDailyChallenge = (
  challenge: DailyChallenge,
  session: SessionData
): boolean => {
  switch (challenge.type) {
    case "wpm":
      return session.wpm >= challenge.target;
    case "accuracy":
      return session.accuracy >= challenge.target;
    case "length":
      return session.textLength >= challenge.target;
    default:
      return false;
  }
};



export function calculateBousesReward(level: number): number {
  if (level < 1) return 0;
  if (level > LINEAR_GROWTH_END_LEVEL) return BASE_XP * MAX_XP_MULTIPLIER;
  // مرحلة النمو الأسّي (المستويات 1-50)
  if (level <= EXP_GROWTH_END_LEVEL) {
    const growthFactor = Math.pow(10, 1 / (EXP_GROWTH_END_LEVEL - 1));
    const percentage = 10 * Math.pow(growthFactor, level - 1);
    return Math.round((percentage / 100) * BASE_XP);
  }
  // مرحلة النمو الخطّي (المستويات 51-100)
  const linearIncrement = (MAX_XP_MULTIPLIER - 1) * BASE_XP / (LINEAR_GROWTH_END_LEVEL - EXP_GROWTH_END_LEVEL);
  return Math.round(BASE_XP + (level - EXP_GROWTH_END_LEVEL) * linearIncrement);
}