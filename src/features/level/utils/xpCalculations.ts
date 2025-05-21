// xpCalculations.ts
import { v4 as uuidv4 } from 'uuid';
import { getChallengeXP } from "@/features/level/utils/xpMath";
import { ACHIEVEMENTS, BONUSES } from "@/features/level/constants/level";
import { logger } from "@/log/clientLogger";
import { XPMessage } from "@/features/level/types/level";

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
  session: any,
  state: any,
  userId?: string,
  addXPMessage?: Function,
  dispatch?: Function
): number => {
  // Performance tracking setup
  const calculationStart = performance.now();
  const sessionId = uuidv4();

  try {
    logger.perf.debug("Starting XP calculation", { sessionId, userId });

    let totalXP = 0;
    const xpEvents: XPMessage[] = [];
    let addedBaseXP: number;

    // Base XP tier system based on user level
    if (state.level <= 5) {
      addedBaseXP = 100; // Beginner tier
    } else if (state.level <= 10) {
      addedBaseXP = 150; // Intermediate tier
    } else if (state.level <= 50) {
      addedBaseXP = 200; // Advanced tier
    } else {
      addedBaseXP = 300; // Expert tier
    }

    // Calculate maximum achievable base XP with level scaling
    const maxBaseXP = Math.min(addedBaseXP + state.level * 10, 1000);

    // Component weights for balanced scoring
    const accuracyWeight = 0.4; // Emphasis on precision
    const textWeight = 0.3;    // Emphasis on content length
    const speedWeight = 0.3;   // Emphasis on typing speed

    // Non-linear accuracy scaling (emphasizes high accuracy)
    const accuracyEffect = Math.pow(session.accuracy / 100, 1.8);

    // Calculate component XP values
    const accuracyXP = Math.round(maxBaseXP * accuracyWeight * accuracyEffect);
    const textXP = Math.round(
      Math.min(
        Math.log(session.textLength + 1) * 70, // Logarithmic length scaling
        maxBaseXP * textWeight
      ) * accuracyEffect
    );
    const speedXP = Math.round(
      Math.min(session.wpm * 1.4, maxBaseXP * speedWeight) *
        Math.pow(accuracyEffect, 2) // Double accuracy impact on speed
    );

    // Aggregate and cap base XP
    let baseXP = accuracyXP + textXP + speedXP;
    baseXP = Math.min(baseXP, maxBaseXP);
    totalXP += baseXP;
    xpEvents.push({
      id: uuidv4(),
      text: `Base XP`,
      value: baseXP,
      type: "base",
    });

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
            ...achievement,
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
            ...achievement,
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
        const calculatedReward = getChallengeXP(state.level);
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
            wpm: session.wpm,
            accuracy: session.accuracy,
            textLength: session.textLength,
          },
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Performance logging
    logger.xp.info("Session XP calculated", {
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
          wpm: session.wpm,
          accuracy: session.accuracy,
          textLength: session.textLength,
        },
      }
    );
    return 0;
  }
};