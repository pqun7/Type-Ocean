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

export type SessionData = {
  wpm: number;
  accuracy: number;
  textLength: number;
  textType?: TextType;
};

export type DailyChallenge = {
  type: "wpm" | "accuracy" | "length";
  target: number;
  xp: number;
  date?: string;
  description?: string;
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
  streak: number;
  dailyChallenge: DailyChallenge;
  achievements: Achievement[];
  addXP: (amount: number) => void;
  calculateSessionXP: (session: SessionData) => number;
  xpMessages: XPMessage[];
  addXPMessage: (text: string, value: number, type: XPMessageType) => void; 
};


export type Bonus = {
  id: string;
  name: string;
  description: string;
  xpReward: number;
  condition: (session: SessionData) => boolean;
};