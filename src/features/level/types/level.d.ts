export type TextType = "SHORT" | "MEDIUM" | "LONG";

export type XPMessageType =
  | "base"
  | "daily-challenge"
  | "achievement"
  | "bonus"
  | "level-up"
  | "error"
  | "participation";

export type XPMessage = {
  id: string;
  text: string;
  value: number;
  type: XPMessageType;
  style?: React.CSSProperties;
};

export type DailyChallenge = {
  id: string;
  // userId: string; 
  type: 'marathon' | 'timeAttack' | 'speedCombo';
  target: number | { wpm: number; accuracy: number };
  xp: number;
  date: string;
  difficulty: number;
  status: 0 | 1 | -1; // 0: not started, 1: completed, -1: in progress
  data?: {
    // Marathon challenge data
    charactersTyped?: number;
    // Time attack challenge data
    timeSpent?: number;
    // Speed combo challenge data
    completedAt?: string;
    finalWpm?: number;
    finalAccuracy?: number;
    bestWpm?: number;
    bestAccuracy?: number;
    attempts?: number;
    // General challenge data
    [key: string]: any; // Allow additional properties for extensibility
  };
  progress?: SessionData; 

};

export type DailyChallengeResponse = {
  completed: boolean;
  xp: number;
  updatedChallenge: {
    id: string;
    progress: Record<string, any>;
    status: number;
    date: string;
  };
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

export type AchievementState = {
  id: string;
  unlocked: boolean;
  progress?: AchievementProgress;
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
  achievements: AchievementState[];
};

export type LevelAction =
  | { type: "ADD_XP"; amount: number }
  | { type: "RESET_PROGRESS" }
  | { type: "SET_PROGRESS"; level: number; userXP: number; achievements: AchievementState[] }
  | { type: "UNLOCK_ACHIEVEMENT"; achievement: AchievementState }
  | { type: "UPDATE_ACHIEVEMENT"; achievement: AchievementState };

  export interface LevelContextType {
    level: number;
    userXP: number;
    nextLevelXP: number;
    userId?: string | null;
    dailyChallenge: DailyChallenge | null;
    dailyChallengeStreak?: number;
    achievements: AchievementState[];
    addXP: (amount: number) => Promise<void>;
    calculateSessionXP: (session: SessionData) => number;
    handleDailyChallenge: (session: SessionData) => Promise<{ completed: boolean; xp: number }>;
    xpMessages: XPMessage[];
    addXPMessage: (text: string, value: number, type: XPMessageType) => void;
    clearXPMessages?: () => void;
    recordSessionStats?: (...args: any[]) => any;
    // Auth/session hydration flags
    isAuthLoading?: boolean;
    isLoadingSession?: boolean;
  }


export interface Session {
  accuracy: number;
  wpm: number;
  textLength: number;
}

export interface Bonus {
  id: string;
  name: string;
  description: string;
  xpReward: number;
  condition: (session: Session) => boolean;
}