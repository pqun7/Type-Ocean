import { DailyChallenge, SessionData } from "@/types/level";
import {
  BASE_XP,
  EXPONENTIAL_GROWTH_LEVEL,
  LINEAR_GROWTH_INCREMENT,
  DAILY_CHALLENGE_BASE_XP,
  LINEAR_GROWTH_END_LEVEL,
  EXP_GROWTH_END_LEVEL,
  MAX_XP_MULTIPLIER,
  CHALLENGE_TYPE_WEIGHTS,
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
  
  const challengeConfig = {
    baseWPM: Math.min(100, 50 + level * 0.8),
    baseAccuracy: Math.min(98, 85 + level * 0.2),
    baseLength: Math.min(800, 300 + level * 3),
    baseTime: Math.min(1800, 600 + level * 15), // بالثواني
  };

  const challengeTypes: Array<Omit<DailyChallenge, 'date' | 'difficulty'> & { weight: number }> = [
      {
        type: "speedCombo" as const,
        target: {
          wpm: Math.round(challengeConfig.baseWPM * (1.15 + Math.random() * 0.15)),
          accuracy: Math.round(challengeConfig.baseAccuracy * (1.05 + Math.random() * 0.05)),
        },
        xp: getChallengeXP(level),
        weight: CHALLENGE_TYPE_WEIGHTS.speedCombo,
      },
      {
        type: "marathon" as const,
        target: Math.round(challengeConfig.baseLength * (1.3 + Math.random() * 0.4)),
        xp: getChallengeXP(level),
        weight: CHALLENGE_TYPE_WEIGHTS.marathon,
      },
      {
        type: "precisionMaster" as const,
        target: {
          accuracy: Math.min(100, Math.round(challengeConfig.baseAccuracy + 3 + Math.random() * 2)),
          maxErrors: Math.max(1, Math.round(5 - level * 0.1)),
        },
        xp: getChallengeXP(level),
        weight: CHALLENGE_TYPE_WEIGHTS.precisionMaster,
      },
      {
        type: "timeAttack" as const,
        target: Math.round(challengeConfig.baseTime * (0.8 + Math.random() * 0.4)),
        xp: getChallengeXP(level),
        weight: CHALLENGE_TYPE_WEIGHTS.timeAttack,
      },
      {
        type: "consistency" as const,
        target: {
          sessions: 3 + Math.floor(level * 0.1),
          minWPM: Math.round(challengeConfig.baseWPM * 0.8),
        },
        xp: getChallengeXP(level),
        weight: CHALLENGE_TYPE_WEIGHTS.consistency,
      },
    ];
    

  // اختيار عشوائي مرجح
  const totalWeight = challengeTypes.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;
  
  const selectedChallenge = challengeTypes.find(challenge => {
    random -= challenge.weight;
    return random <= 0;
  })!;

  const { weight, ...challengeWithoutWeight } = selectedChallenge;



  return {
    ...challengeWithoutWeight,
    date: today,
    difficulty: level,
    type: selectedChallenge.type,
    target: selectedChallenge.target,
    xp: selectedChallenge.xp,
  } as DailyChallenge;
};

export const checkDailyChallenge = (
  challenge: DailyChallenge,
  session: SessionData
): boolean => {
  switch (challenge.type) {
    case "speedCombo":
      return session.wpm >= challenge.target.wpm && 
             session.accuracy >= challenge.target.accuracy;
    
    case "marathon":
      return session.textLength >= challenge.target;
    
    case "precisionMaster":
      return session.accuracy >= challenge.target.accuracy && 
             session.errors <= challenge.target.maxErrors;
    
    case "timeAttack":
      const baseWPM = Math.min(100, 50 + challenge.difficulty * 0.8);
      return session.timeSpent >= challenge.target &&
             session.wpm >= baseWPM * 0.7;
    
    case "consistency":
      return session.sessionsCount >= challenge.target.sessions &&
             session.dailyAvgWpm >= challenge.target.minWPM;
    
    default:
      return false;
  }
};


export function getChallengeXP(level: number): number {
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

