import { Achievement, Bonus, Session } from "@/types/level";

export const BASE_XP = 500;

export const EXPONENTIAL_GROWTH_LEVEL = 5;
export const LINEAR_GROWTH_INCREMENT = 300;
export const DAILY_CHALLENGE_BASE_XP = 200;

export const EXP_GROWTH_END_LEVEL = 50;
export const LINEAR_GROWTH_END_LEVEL = 100;
export const MAX_XP_MULTIPLIER = 2;

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "speed_demon",
    name: "Speed Demon",
    description: "Reach 100 WPM in a session",
    xpReward: 500,
    condition: (session) => ({
      achieved: session.wpm >= 100,
      current: session.wpm,
    }),
  },
  {
    id: "perfectionist",
    name: "Perfectionist",
    description: "Complete 5 sessions with 100% accuracy",
    xpReward: 1200,
    progress: { current: 0, target: 5 },
    condition: (session, progress) => {
      const newProgress =
        session.accuracy === 100
          ? (progress?.current || 0) + 1
          : progress?.current || 0;
      return {
        achieved: newProgress >= 5,
        current: newProgress,
      };
    },
  },
];



export const BONUSES: Bonus[] = [
  {
    id: "perfect_accuracy",
    name: "Perfect Accuracy",
    description: "Achieve 100% accuracy in a session",
    xpReward: 200,
    condition: (session: Session) => session.accuracy === 100,
  },
  {
    id: "speed_60",
    name: "Speed Racer",
    description: "Reach 60+ WPM in a session",
    xpReward: 300,
    condition: (session: Session) => session.wpm >= 60,
  },
  {
    id: "speed_80",
    name: "Lightning Speed",
    description: "Reach 80+ WPM in a session",
    xpReward: 500,
    condition: (session: Session) => session.wpm >= 80,
  },
  {
    id: "long_session",
    name: "Marathon Typist",
    description: "Complete a session with 500+ characters",
    xpReward: 150,
    condition: (session: Session) => session.textLength >= 500,
  },
];

export const CHALLENGE_MODIFIERS = {
  GLOBAL: ["timePressure", "hiddenText", "shiftingKeyboard"],
  TYPE_SPECIFIC: {
    wpm: ["speedBoost", "penaltySlowdown"],
    accuracy: ["perfectMode", "doublePenalty"],
    length: ["enduranceMode", "progressiveDifficulty"],
    consistency: ["rhythmKeeper", "fluctuationPenalty"],
    DIFFICULTY_SCALING: {
      speedCombo: 1.15,
      marathon: 1.3,
      precisionMaster: 1.2,
      timeAttack: 0.9,
      consistency: 1.1,
    },
    STREAK_MULTIPLIER: 0.05,
  },
};


export const CHALLENGE_TYPE_WEIGHTS = {
  speedCombo: 25,
  marathon: 20,
  precisionMaster: 22,
  timeAttack: 18,
  consistency: 15,
};