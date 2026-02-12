// xpCalculations.ts
import { v4 as uuidv4 } from "uuid";
import { ACHIEVEMENTS, BONUSES } from "@/features/level/constants/level";
import { logger } from "@/log/clientLogger";
import type { LevelState, SessionData, XPMessage } from "@/features/level/types/level";

type AddXPMessage = (text: string, value: number, type: XPMessage["type"]) => void;

type LevelDispatchAction =
  | {
      type: "UNLOCK_ACHIEVEMENT";
      achievement: {
        id: string;
        unlocked: true;
        progress?: {
          current: number;
          target: number;
        };
      };
    }
  | {
      type: "UPDATE_ACHIEVEMENT";
      achievement: {
        id: string;
        unlocked: false;
        progress: {
          current: number;
          target: number;
        };
      };
    };

type LevelDispatch = (action: LevelDispatchAction) => void;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Calculates XP earned from a typing session with complex scoring logic
 * @param session - Typing session data including WPM, accuracy, and text metadata
 * @param state - Current user level state
 * @param userId - Optional user ID for logging and tracking
 * @param addXPMessage - Callback for XP notification display
 * @param dispatch - State management dispatcher
 * @returns Total XP earned from the session
 */
export const calculateSessionXP = (
  session: SessionData,
  state: LevelState,
  userId?: string,
  addXPMessage?: AddXPMessage,
  dispatch?: LevelDispatch
): number => {
  // Performance tracking setup
  const calculationStart = performance.now();
  const sessionId = uuidv4();

  try {
    logger.perf.debug("Starting XP calculation", {
      sessionId,
      userId,
    });

    let totalXP = 0;
    const xpEvents: XPMessage[] = [];
    let addedBaseXP: number;

    const level = Math.max(1, Number(state.level) || 1);
    const wpm = Math.max(0, Number(session.wpm) || 0);
    const accuracyPct = clamp(Number(session.accuracy) || 0, 0, 100);
    const accuracy = accuracyPct / 100;
    const textLength = Math.max(1, Number(session.textLength) || 1);
    const timeSpentSec = Math.max(0, Number(session.timeSpent) || 0);
    const errors = Math.max(0, Number(session.errors) || 0);

    // Base XP tier system based on user level
    if (level <= 5) {
      addedBaseXP = 100; // Beginner tier
    } else if (level <= 10) {
      addedBaseXP = 150; // Intermediate tier
    } else if (level <= 50) {
      addedBaseXP = 200; // Advanced tier
    } else {
      addedBaseXP = 300; // Expert tier
    }

    // Calculate maximum achievable base XP with level scaling
    const maxBaseXP = Math.min(addedBaseXP + level * 10, 1000);

    // --- Advanced, fair XP scaling (focus: earned XP) ---
    // 1) Completion estimate (prevents tiny-session farming)
    const estimatedCharsTyped = wpm * (timeSpentSec / 60) * 5;
    const completionRatio = clamp01(estimatedCharsTyped / textLength);
    const completionFactor = smoothstep(0.25, 0.95, completionRatio);

    // 2) Effort/time curve: short sessions get less, long sessions saturate
    const effortFactor = 1 - Math.exp(-timeSpentSec / 35);
    const timeScale = 0.35 + 0.65 * clamp01(effortFactor);

    // 3) Accuracy curve: strongly rewards high precision (but still gives something)
    const accuracyGate = smoothstep(0.84, 0.97, accuracy);
    const accuracyFactor = Math.pow(accuracy, 2.15) * (0.55 + 0.45 * accuracyGate);

    // 4) Speed curve relative to level-based target (diminishing returns)
    const targetWpm = 28 + Math.min(level, 60) * 0.75;
    const speedFactor = clamp01(Math.tanh(targetWpm > 0 ? wpm / targetWpm : 0));

    // 5) Cleanliness: penalize excessive mistakes relative to length
    const errorRate = errors / textLength;
    const cleanFactor = 1 - clamp(errorRate * 2.75, 0, 0.28);

    const isLongText = session.textType === "LONG" || textLength >= 420;

    // 6) Text type multiplier (small; keeps changes minimal)
    const typeMult = isLongText ? 1.1 : session.textType === "SHORT" ? 0.95 : 1.0;

    // 7) Length factor: rewards longer texts but with diminishing returns.
    // Long texts get a wider curve so they feel worth it.
    const lengthDenom = isLongText ? 1200 : 500;
    const lengthFactor = clamp01(Math.log1p(textLength) / Math.log1p(lengthDenom));

    // Component weights (balanced; accuracy slightly favored)
    const accuracyWeight = 0.45;
    const speedWeight = 0.35;
    const lengthWeight = 0.20;

    const accuracyXP = maxBaseXP * accuracyWeight * accuracyFactor;
    const speedXP = maxBaseXP * speedWeight * speedFactor * (0.45 + 0.55 * accuracyFactor);
    const textXP = maxBaseXP * lengthWeight * lengthFactor;

    // Aggregate with scaling factors (completion + time + cleanliness)
    const completionScale = 0.55 + 0.45 * completionFactor;
    let baseXP = Math.round((accuracyXP + speedXP + textXP) * timeScale * completionScale * cleanFactor * typeMult);

    // Hard floor for extremely low-effort sessions
    if (timeSpentSec < 8 && completionRatio < 0.18) baseXP = 0;

    // Allow small overcap for great runs (keeps it "fun")
    const overcap = 1.05 + 0.1 * accuracyGate * speedFactor;
    baseXP = Math.min(baseXP, Math.round(maxBaseXP * overcap));
    baseXP = Math.max(0, baseXP);

    // Small “Flow” bonus: very good, complete run
    const isFlow =
      accuracyPct >= 98 &&
      completionRatio >= 0.95 &&
      timeSpentSec >= 25 &&
      wpm >= targetWpm;
    totalXP += baseXP;
    xpEvents.push({
      id: uuidv4(),
      text: `Base XP`,
      value: baseXP,
      type: "base",
    });

    if (isFlow) {
      const flowXP = Math.max(10, Math.round(maxBaseXP * 0.12));
      totalXP += flowXP;
      xpEvents.push({
        id: uuidv4(),
        text: "Flow Bonus",
        value: flowXP,
        type: "bonus",
      });
    }

    // Long-text character-based bonuses (fun + fair)
    // Gated to discourage farming: requires meaningful time + completion + decent accuracy.
    if (isLongText && timeSpentSec >= 30 && completionRatio >= 0.85 && accuracyPct >= 90) {
      // 1) Milestone tiers based on planned text length
      const tierCount = clamp(Math.floor(textLength / 250) - 1, 0, 6); // 0 until ~500 chars
      if (tierCount > 0) {
        const tierBase = 14 + Math.min(level, 80) * 0.35;
        const tierXP = Math.round(
          tierBase * tierCount * (0.65 + 0.35 * accuracyGate) * (0.7 + 0.3 * completionFactor) * (0.85 + 0.15 * speedFactor)
        );

        const enduranceMilestoneXP = clamp(tierXP, 0, Math.round(maxBaseXP * 0.22));
        if (enduranceMilestoneXP > 0) {
          totalXP += enduranceMilestoneXP;
          xpEvents.push({
            id: uuidv4(),
            text: `Endurance Milestone (${Math.min(textLength, 1500).toLocaleString()} chars)`,
            value: enduranceMilestoneXP,
            type: "bonus",
          });
        }
      }

      // 2) Continuous character bonus (based on characters "covered" with completion/accuracy gates)
      const effectiveChars = Math.min(textLength, Math.max(0, estimatedCharsTyped));
      const over = Math.max(0, Math.min(effectiveChars, 1800) - 380);
      const charXP = Math.round(Math.sqrt(over) * 1.35 * (0.55 + 0.45 * accuracyGate) * (0.6 + 0.4 * completionFactor));
      const enduranceCharXP = clamp(charXP, 0, Math.round(maxBaseXP * 0.18));
      if (enduranceCharXP > 0) {
        totalXP += enduranceCharXP;
        xpEvents.push({
          id: uuidv4(),
          text: `Character Bonus`,
          value: enduranceCharXP,
          type: "bonus",
        });
      }
    }

    // Achievement processing pipeline
    ACHIEVEMENTS.forEach((achievement) => {
      const existing = state.achievements.find((a: any) => a.id === achievement.id);
      if (existing?.unlocked) return; // Skip already unlocked achievements

      // Check achievement conditions
      const result = achievement.condition(session, existing?.progress);

      if (result.achieved) {
        // Unlock new achievement
        xpEvents.push({
          id: uuidv4(),
          text: `${achievement.name}`,
          value: achievement.xpReward,
          type: "achievement",
        });
        totalXP += achievement.xpReward;

        // Update global state
        dispatch?.({
          type: "UNLOCK_ACHIEVEMENT",
          achievement: {
            id: achievement.id,
            unlocked: true,
            progress: result.current
              ? {
                  current: result.current,
                  target: achievement.progress?.target || result.current,
                }
              : undefined,
          },
        });
      } else if (result.current !== undefined) {
        // Update achievement progress
        dispatch?.({
          type: "UPDATE_ACHIEVEMENT",
          achievement: {
            id: achievement.id,
            unlocked: false,
            progress: {
              current: result.current,
              target: achievement.progress?.target || result.current,
            },
          },
        });
      }
    });

    // Apply conditional bonuses
    BONUSES.forEach((bonus) => {
      if (bonus.condition(session)) {
        // Use declared bonus reward, scaled slightly by performance (kept bounded)
        const performanceScale = 0.85 + 0.15 * accuracyGate;
        const speedScale = 0.9 + 0.1 * speedFactor;
        const reward = Math.round(bonus.xpReward * performanceScale * speedScale);
        const calculatedReward = clamp(reward, Math.round(bonus.xpReward * 0.75), Math.round(bonus.xpReward * 1.6));

        totalXP += calculatedReward;
        xpEvents.push({
          id: uuidv4(),
          text: `${bonus.name}`,
          value: calculatedReward,
          type: "bonus",
        });
      }
    });

    // Dispatch XP notifications
    xpEvents.forEach((msg) => {
      if (msg.value > 0) {
        addXPMessage?.(msg.text, msg.value, msg.type);
      }
    });

    // High XP event monitoring
    if (totalXP > 500) {
      console.warn(
        JSON.stringify({
          type: "HIGH_XP_EVENT",
          userId,
          totalXP,
          sessionDetails: {
            wpm,
            accuracy: accuracyPct,
            textLength,
          },
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Performance logging
    logger.xp.info("Session XP calculated" ,{
      sessionId,
      totalXP,
      duration: `${performance.now() - calculationStart}ms`,
    });

    return totalXP;
  } catch (error) {
    // Error handling and diagnostics
    logger.xp.error(
      "XP calculation failed",
      error instanceof Error ? error : undefined,
      {
        sessionId,
        userId,
        sessionDetails: {
          wpm: Math.max(0, Number(session.wpm) || 0),
          accuracy: clamp(Number(session.accuracy) || 0, 0, 100),
          textLength: Math.max(1, Number(session.textLength) || 1),
        },
      }
    );
    return 0;
  }
};
