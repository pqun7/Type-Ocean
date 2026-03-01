import { Achievement, Bonus, MythicBonus, Session, SessionData } from "@/features/level/types/level";

export const BASE_XP = 500;

export const EXPONENTIAL_GROWTH_LEVEL = 5;
export const LINEAR_GROWTH_INCREMENT = 300;
export const DAILY_CHALLENGE_BASE_XP = 200;

export const EXP_GROWTH_END_LEVEL = 50;
export const LINEAR_GROWTH_END_LEVEL = 100;
export const MAX_XP_MULTIPLIER = 2;

export const ACHIEVEMENTS: Achievement[] = [
  // ── Tier 1: Common ─────────────────────────────────────────────────────────
  {
    id: "velocity",
    name: "Blitz",
    description: "Reach 80 WPM in a single session",
    xpReward: 400,
    condition: (session) => ({ achieved: session.wpm >= 80, current: session.wpm }),
  },

  // ── Tier 2: Rare ──────────────────────────────────────────────────────────
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
  {
    id: "consistent_edge",
    name: "Consistent Edge",
    description: "Complete 10 sessions with consistency ≥ 85%",
    xpReward: 800,
    progress: { current: 0, target: 10 },
    condition: (session, progress) => {
      const newProgress =
        (session.consistency ?? 0) >= 85
          ? (progress?.current || 0) + 1
          : progress?.current || 0;
      return { achieved: newProgress >= 10, current: newProgress };
    },
  },
  {
    id: "century",
    name: "Centurion",
    description: "Complete 100 typing sessions",
    xpReward: 2000,
    progress: { current: 0, target: 100 },
    condition: (_session, progress) => {
      const newProgress = (progress?.current || 0) + 1;
      return { achieved: newProgress >= 100, current: newProgress };
    },
  },

  // ── Tier 3: Epic ──────────────────────────────────────────────────────────
  {
    id: "velocity_god",
    name: "Velocity God",
    description: "Reach 120 WPM in a single session",
    xpReward: 1500,
    condition: (session) => ({ achieved: session.wpm >= 120, current: session.wpm }),
  },
  {
    id: "the_surgeon",
    name: "Precision",
    description: "Complete 20 sessions with ≥ 99% accuracy",
    xpReward: 1500,
    progress: { current: 0, target: 20 },
    condition: (session, progress) => {
      const newProgress =
        session.accuracy >= 99
          ? (progress?.current || 0) + 1
          : progress?.current || 0;
      return { achieved: newProgress >= 20, current: newProgress };
    },
  },

  // ── Tier 4: Legendary ────────────────────────────────────────────────────
  {
    id: "iron_fingers",
    name: "Iron Fingers",
    description: "Type a total of 100,000 characters across all sessions",
    xpReward: 3000,
    progress: { current: 0, target: 100000 },
    condition: (session, progress) => {
      const newProgress = (progress?.current || 0) + session.textLength;
      return { achieved: newProgress >= 100000, current: newProgress };
    },
  },

  // ── Tier 5: Mythic — elite proof ─────────────────────────────────────────
  {
    id: "ghost_protocol",
    name: "Ghost Protocol",
    description: "Complete 5 sessions with 100% accuracy, zero errors, ≥95% consistency and ≥90 WPM",
    xpReward: 5000,
    progress: { current: 0, target: 5 },
    condition: (session, progress) => {
      const qualifies =
        session.accuracy === 100 &&
        session.errors === 0 &&
        (session.consistency ?? 0) >= 95 &&
        session.wpm >= 90;
      const newProgress = qualifies
        ? (progress?.current || 0) + 1
        : progress?.current || 0;
      return { achieved: newProgress >= 5, current: newProgress };
    },
  },
];



export const BONUSES: Bonus[] = [
  {
    id: "perfect_accuracy",
    name: "Perfect Accuracy",
    description: "Achieve 100% accuracy in a session",
    xpReward: 250,
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



export const XP_LOGGING_THRESHOLDS = {
  BASE: 50,
  BONUS: 100,
  LEVEL_UP: 200,
};


export type XPMessageType = keyof typeof XP_MESSAGE_TIMEOUT;

/**
 * Mythic bonuses: rare, high-impact rewards gated by multi-condition rarity bars.
 * Each bonus receives the full SessionData plus the level-calibrated targetWpm.
 * Hard caps are enforced inside xpCalculations.ts per entry below.
 */
export const MYTHIC_BONUSES: MythicBonus[] = [
  {
    id: "flawless_run",
    name: "Flawless Run",
    // Hard but reachable: zero corrections (no backspace), perfect accuracy, solid consistency.
    // WPM scales with level via targetWpm — a level-5 player needs ~27 WPM, level-60+ needs ~62 WPM.
    description: "Zero errors, zero corrections, 100% accuracy, 85%+ consistency, 85% of target speed",
    condition: (session: SessionData, targetWpm: number) =>
      session.errors === 0 &&
      (session.corrections ?? 1) === 0 &&
      session.accuracy === 100 &&
      (session.consistency ?? 0) >= 85 &&
      session.wpm >= targetWpm * 0.85,
  },
  {
    id: "speed_god",
    name: "Speed God",
    // Level-scaled WPM floor (78 WPM at low levels → 120 WPM at max level).
    // Hard cap: 150 WPM — competition-typist territory but not superhuman.
    description: "Level-scaled WPM (78–120 WPM), 95%+ accuracy, 78%+ consistency",
    condition: (session: SessionData, targetWpm: number) => {
      const threshold = Math.min(Math.max(targetWpm * 1.65, 78), 120);
      return (
        session.wpm >= threshold &&
        session.accuracy >= 95 &&
        (session.consistency ?? 0) >= 78
      );
    },
  },
  {
    id: "eternal_precision",
    name: "Eternal Precision",
    // Accessible to careful slow typists: 100% accuracy is the bottleneck, not speed.
    // Required text length scales gently with level (400–550 chars); time lowered to 45s.
    description: "100% accuracy on a scaled-length text (400–550+ chars, 45s+), 82%+ consistency",
    condition: (session: SessionData, targetWpm: number) => {
      const minLen  = Math.min(Math.max(Math.round(350 + targetWpm * 1.5), 400), 550);
      return (
        session.accuracy === 100 &&
        (session.textType === "LONG" || session.textLength >= 420) &&
        session.textLength >= minLen &&
        session.timeSpent >= 45 &&
        (session.consistency ?? 0) >= 82
      );
    },
  },
  {
    id: "perfect_storm",
    name: "Perfect Storm",
    // Ultra-rare: every flawless_run condition PLUS a new personal best WPM in the same run.
    // WPM requirement slightly higher than flawless_run (0.90 vs 0.85) so it stays elite.
    description: "Flawless Run conditions (85%+ consistency, 90% target speed) AND a new personal best",
    condition: (session: SessionData, targetWpm: number) =>
      session.errors === 0 &&
      (session.corrections ?? 1) === 0 &&
      session.accuracy === 100 &&
      (session.consistency ?? 0) >= 85 &&
      session.wpm >= targetWpm * 0.9 &&
      (session.prevBestWpm ?? 0) > 0 &&
      session.wpm > (session.prevBestWpm ?? 0),
  },
];

export const XP_MESSAGE_TIMEOUT = {
  BASE: 3000,
  BONUS: 5000,
  LEVEL_UP: 7000,
  ACHIEVEMENT: 7000,
  PARTICIPATION: 3000,
  "DAILY-CHALLENGE": 6000,
  MYTHIC: 7500,
  "PERSONAL-BEST": 6500,
  ERROR: 4000,
} as const;