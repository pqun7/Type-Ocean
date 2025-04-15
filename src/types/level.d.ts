export type TextType = "SHORT" | "MEDIUM" | "LONG";

export type XPMessageType =
  | "base"
  | "daily-challenge"
  | "achievement"
  | "bonus"
  | "level-up"
  | "participation";

export type XPMessage = {
  id: string;
  text: string;
  value: number;
  type: XPMessageType;
  style?: React.CSSProperties;
};

// types/level.d.ts
export type DailyChallenge =
  | {
      type: "speedCombo";
      target: { wpm: number; accuracy: number };
      xp: number;
      date: string;
      difficulty: number;
    }
  | {
      type: "marathon";
      target: number;
      xp: number;
      date: string;
      difficulty: number;
    }
  | {
      type: "precisionMaster";
      target: { accuracy: number; maxErrors: number };
      xp: number;
      date: string;
      difficulty: number;
    }
  | {
      type: "timeAttack";
      target: number;
      xp: number;
      date: string;
      difficulty: number;
    }
  | {
      type: "consistency";
      target: { sessions: number; minWPM: number };
      xp: number;
      date: string;
      difficulty: number;
};

export type SessionData = {
  wpm: number;
  accuracy: number;
  textLength: number;
  textType?: TextType;
  timeSpent: number;
  errors: number;
  dailyAvgWpm: number;
  dailyAvgAcc: number;
  sessionsCount: number;
};

export type DailyStats = {
  n: number;
  avgWpm: number;
  avgAcc: number;
  date: string;
  lastWpm: number;
  lastAcc: number;
};

export type AchievementProgress = {
  current: number;
  target: number;
};

export type Achievement = {
  id: string;
  name: string;
  description: string;
  xpReward: number;
  condition: (
    session: SessionData,
    progress?: AchievementProgress
  ) => AchievementCheckResult;
  progress?: AchievementProgress;
  unlocked?: boolean;
};

export type AchievementCheckResult = {
  achieved: boolean;
  current?: number;
};

export type LevelState = {
  level: number;
  userXP: number;
  nextLevelXP: number;
  achievements: Achievement[];
};

export type LevelAction =
  | { type: "ADD_XP"; amount: number }
  | { type: "UNLOCK_ACHIEVEMENT"; achievement: Achievement }
  | { type: "UPDATE_ACHIEVEMENT"; achievement: Achievement };

export type LevelContextType = {
  level: number;
  userXP: number;
  nextLevelXP: number;
  dailyChallenge: DailyChallenge;
  achievements: Achievement[];
  addXP: (amount: number) => void;
  calculateSessionXP: (session: SessionData) => number;
  xpMessages: XPMessage[];
  addXPMessage: (text: string, value: number, type: XPMessageType) => void;
  streak: number;
  calculateDailyAverage: (
    newWpm: number,
    newAcc: number
  ) => {
    dailyAvgWpm: number;
    dailyAvgAcc: number;
    sessionsCount: number;
  };
  handleDailyChallenge: (session: SessionData) => {
    completed: boolean;
    xp: number;
  };
};

export type Bonus = {
  id: string;
  name: string;
  description: string;
  xpReward: number;
  condition: (session: SessionData) => boolean;
};
