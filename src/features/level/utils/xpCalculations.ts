// xpCalculations.ts
import { v4 as uuidv4 } from "uuid";
import { ACHIEVEMENTS, BONUSES, MYTHIC_BONUSES } from "@/features/level/constants/level";
import { logger } from "@/log/clientLogger";
import type { LevelState, MythicClaimMeta, SessionData, XPMessage } from "@/features/level/types/level";

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

/** Metadata about mythic/PB claims — re-exported from types for convenience */
export type { MythicClaimMeta } from "@/features/level/types/level";

/**
 * Validates all SessionData fields are finite numbers within expected ranges.
 * Returns false (silently logs) if data looks corrupted or client-tampered.
 */
export const validateSessionData = (session: SessionData): boolean => {
  const checks = [
    Number.isFinite(session.wpm) && session.wpm >= 0 && session.wpm <= 500,
    Number.isFinite(session.accuracy) && session.accuracy >= 0 && session.accuracy <= 100,
    Number.isFinite(session.textLength) && session.textLength > 0,
    Number.isFinite(session.timeSpent) && session.timeSpent >= 0,
    Number.isFinite(session.errors) && session.errors >= 0,
    session.corrections === undefined ||
      (Number.isFinite(session.corrections) && session.corrections >= 0),
    session.consistency === undefined ||
      (Number.isFinite(session.consistency) &&
        session.consistency >= 0 &&
        session.consistency <= 100),
    session.prevBestWpm === undefined ||
      (Number.isFinite(session.prevBestWpm) &&
        session.prevBestWpm >= 0 &&
        session.prevBestWpm <= 500),
  ];
  return checks.every(Boolean);
};

/**
 * Calculates XP earned from a typing session.
 *
 * Key additions over base version:
 * - corrections + consistency factors wired into cleanFactor / bonus formulas
 * - Steady Hands bonus (consistency ≥ 80%)
 * - Personal Best bonus (wpm > prevBestWpm)
 * - Mythic Bonuses (flawless_run / speed_god / eternal_precision / perfect_storm)
 * - Mutual exclusivity: perfect_storm suppresses flawless_run + personal-best
 * - onMythicClaim callback for optional server-side PB/mythic validation
 *
 * @param session     - Full session data (wpm, accuracy, errors, corrections, consistency, prevBestWpm, …)
 * @param state       - Current user level state
 * @param userId      - Optional: for logging
 * @param addXPMessage - Callback for XP notification display
 * @param dispatch    - Reducer dispatcher
 * @param onMythicClaim - Optional: called when mythic/PB bonuses fire (for server validation)
 * @returns Total XP earned
 */
export const calculateSessionXP = (
  session: SessionData,
  state: LevelState,
  userId?: string,
  addXPMessage?: AddXPMessage,
  dispatch?: LevelDispatch,
  onMythicClaim?: (meta: MythicClaimMeta) => void
): number => {
  const calculationStart = performance.now();
  const sessionId = uuidv4();

  try {
    logger.perf.debug("Starting XP calculation", { sessionId, userId });

    // Guard: reject clearly invalid/corrupted session data
    if (!validateSessionData(session)) {
      logger.xp.warn("Invalid session data rejected", { sessionId, userId });
      return 0;
    }

    let totalXP = 0;
    const xpEvents: XPMessage[] = [];
    let addedBaseXP: number;

    // ── Input normalisation ──────────────────────────────────────────────────
    const level        = Math.max(1, Number(state.level) || 1);
    const wpm          = Math.max(0, Number(session.wpm) || 0);
    const accuracyPct  = clamp(Number(session.accuracy) || 0, 0, 100);
    const accuracy     = accuracyPct / 100;
    const textLength   = Math.max(1, Number(session.textLength) || 1);
    const timeSpentSec = Math.max(0, Number(session.timeSpent) || 0);
    const errors       = Math.max(0, Number(session.errors) || 0);
    const corrections  = Math.max(0, Number(session.corrections ?? 0));
    const consistency  =
      session.consistency !== undefined && Number.isFinite(session.consistency)
        ? clamp(session.consistency, 0, 100)
        : undefined;
    const prevBestWpm  =
      session.prevBestWpm !== undefined && Number.isFinite(session.prevBestWpm)
        ? Math.max(0, session.prevBestWpm)
        : 0;

    // ── XP tier pool (based on player level) ────────────────────────────────
    if (level <= 5)       addedBaseXP = 100;
    else if (level <= 10) addedBaseXP = 150;
    else if (level <= 50) addedBaseXP = 200;
    else                  addedBaseXP = 300;
    const maxBaseXP = Math.min(addedBaseXP + level * 10, 1000);

    // ── Pre-computed shared factors (calculated once, reused across all bonus loops) ──
    // 1) Completion estimate — blocks tiny-session XP farming
    const estimatedCharsTyped = wpm * (timeSpentSec / 60) * 5;
    const completionRatio     = clamp01(estimatedCharsTyped / textLength);
    const completionFactor    = smoothstep(0.25, 0.95, completionRatio);

    // 2) Effort/time curve
    const effortFactor = 1 - Math.exp(-timeSpentSec / 35);
    const timeScale    = 0.35 + 0.65 * clamp01(effortFactor);

    // 3) Accuracy curve — rewards high precision
    const accuracyGate   = smoothstep(0.84, 0.97, accuracy);
    const accuracyFactor = Math.pow(accuracy, 2.15) * (0.55 + 0.45 * accuracyGate);

    // 4) Speed curve relative to level-calibrated target
    const targetWpm   = 28 + Math.min(level, 60) * 0.75;
    const speedFactor = clamp01(Math.tanh(targetWpm > 0 ? wpm / targetWpm : 0));

    // 5) Cleanliness — penalises errors AND excessive corrections
    //    correctionPenalty: many backspaces on a short text signals sloppy typing
    //    even when final accuracy looks high.
    const correctionRate    = corrections / textLength;
    const correctionPenalty = clamp(correctionRate * 1.5, 0, 0.12);
    const errorRate         = errors / textLength;
    const cleanFactor       = (1 - clamp(errorRate * 2.75, 0, 0.28)) * (1 - correctionPenalty);

    const isLongText  = session.textType === "LONG" || textLength >= 420;

    // 6) Text-type multiplier
    const typeMult    = isLongText ? 1.1 : session.textType === "SHORT" ? 0.95 : 1.0;

    // 7) Length factor with diminishing returns
    const lengthDenom  = isLongText ? 1200 : 500;
    const lengthFactor = clamp01(Math.log1p(textLength) / Math.log1p(lengthDenom));

    // 8) Consistency factor — neutral 0.5 when unknown (no regression for old sessions)
    const consistencyFactor =
      consistency !== undefined
        ? smoothstep(0.70, 0.97, consistency / 100)
        : 0.5;

    // ── Base XP ──────────────────────────────────────────────────────────────
    const accuracyXP = maxBaseXP * 0.45 * accuracyFactor;
    const speedXP    = maxBaseXP * 0.35 * speedFactor * (0.45 + 0.55 * accuracyFactor);
    const textXP     = maxBaseXP * 0.20 * lengthFactor;

    const completionScale = 0.55 + 0.45 * completionFactor;
    let baseXP = Math.round(
      (accuracyXP + speedXP + textXP) * timeScale * completionScale * cleanFactor * typeMult
    );

    if (timeSpentSec < 8 && completionRatio < 0.18) baseXP = 0;

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

    // ── Steady Hands Bonus (consistency-driven, threshold 80%) ──────────────
    if (consistency !== undefined && consistency >= 80 && wpm >= targetWpm * 0.7) {
      const steadyRaw = Math.round(
        maxBaseXP * 0.18 *
        smoothstep(0.80, 0.97, consistency / 100) *
        (0.5 + 0.5 * speedFactor)
      );
      const steadyXP = Math.min(steadyRaw, Math.round(maxBaseXP * 0.20), 200);
      if (steadyXP > 0) {
        totalXP += steadyXP;
        xpEvents.push({ id: uuidv4(), text: "Steady Hands", value: steadyXP, type: "bonus" });
      }
    }

    // ── Achievement processing ───────────────────────────────────────────────
    ACHIEVEMENTS.forEach((achievement) => {
      const existing = state.achievements.find((a: any) => a.id === achievement.id);
      if (existing?.unlocked) return; // Skip already unlocked achievements

      // Check achievement conditions
      const result = achievement.condition(session, existing?.progress);

      if (result.achieved) {
        // Dynamic reward: floor = base xpReward, ceiling = base × 1.40
        let achievementReward = achievement.xpReward;

        if (achievement.id === "speed_demon") {
          // Scale based on WPM surplus above 100 (100→150 WPM adds 0%–30%)
          const overSpeed = Math.max(0, wpm - 100);
          const scale = 1 + Math.min(overSpeed / 100, 0.30) * (0.55 + 0.45 * consistencyFactor);
          achievementReward = clamp(
            Math.round(achievement.xpReward * scale),
            achievement.xpReward,
            Math.round(achievement.xpReward * 1.40)
          );
        } else if (achievement.id === "velocity") {
          // Scale based on WPM surplus above 80 (80→120 WPM adds 0%–30%)
          const overSpeed = Math.max(0, wpm - 80);
          const scale = 1 + Math.min(overSpeed / 80, 0.30) * (0.6 + 0.4 * accuracyGate);
          achievementReward = clamp(
            Math.round(achievement.xpReward * scale),
            achievement.xpReward,
            Math.round(achievement.xpReward * 1.40)
          );
        } else if (achievement.id === "velocity_god") {
          // Scale based on WPM surplus above 120 (120→160 WPM adds 0%–35%)
          const overSpeed = Math.max(0, wpm - 120);
          const scale = 1 + Math.min(overSpeed / 80, 0.35) * (0.5 + 0.5 * consistencyFactor);
          achievementReward = clamp(
            Math.round(achievement.xpReward * scale),
            achievement.xpReward,
            Math.round(achievement.xpReward * 1.40)
          );
        } else if (achievement.id === "the_surgeon") {
          // Bonus for perfect 100% accuracy vs 99%
          const precisionBonus = accuracyPct === 100 ? 0.15 : 0;
          const scale = 1 + precisionBonus * (0.5 + 0.5 * consistencyFactor);
          achievementReward = clamp(
            Math.round(achievement.xpReward * scale),
            achievement.xpReward,
            Math.round(achievement.xpReward * 1.40)
          );
        } else if (achievement.id === "ghost_protocol") {
          // Mythic: scales with consistency quality above 95%
          // 95%→100% consistency adds up to 30% bonus, weighted by speed above 90 WPM
          const consistencyExcess = Math.max(0, (session.consistency ?? 0) - 95) / 5; // 0→1
          const speedExcess       = Math.min(Math.max(0, wpm - 90) / 40, 1);          // 0→1
          const scale = 1 + consistencyExcess * 0.30 * (0.5 + 0.5 * speedExcess);
          achievementReward = clamp(
            Math.round(achievement.xpReward * scale),
            achievement.xpReward,
            Math.round(achievement.xpReward * 1.40)
          );
        }

        // Unlock new achievement
        xpEvents.push({
          id: uuidv4(),
          text: `${achievement.name}`,
          value: achievementReward,
          type: "achievement",
        });
        totalXP += achievementReward;

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

    // ── Standard Bonuses (dynamic scaling — floor = base, ceiling = base × 1.40) ──
    //
    // Speed tiers are mutually exclusive: only the highest qualifying tier fires
    // per session (Speed Racer 60–79 WPM → Lightning Speed 80–99 WPM).
    // Speed Demon (100+ WPM) is an ACHIEVEMENT and handled above.
    const highestSpeedTierId =
      wpm >= 80 ? "speed_80" :
      wpm >= 60 ? "speed_60" :
      null;

    BONUSES.forEach((bonus) => {
      if (!bonus.condition(session)) return;

      // Mutually exclusive speed tiers — skip lower tiers when a higher one qualifies
      if ((bonus.id === "speed_60" || bonus.id === "speed_80") && bonus.id !== highestSpeedTierId) return;

      // Per-bonus surplus factor: captures performance above the trigger threshold.
      // Combined with perfAccScale below, the total reward lands in [base, base × 1.40].
      let surplusFactor = 1.0;
      if (bonus.id === "speed_60") {
        // WPM surplus 60→90, softened by accuracy quality
        surplusFactor = 1 + Math.min((wpm - 60) / 80, 0.28) * (0.55 + 0.45 * accuracyGate);
      } else if (bonus.id === "speed_80") {
        // WPM surplus 80→120, softened by accuracy quality
        surplusFactor = 1 + Math.min((wpm - 80) / 80, 0.28) * (0.55 + 0.45 * accuracyGate);
      } else if (bonus.id === "long_session") {
        // Text length surplus 500→1500, weighted by completion quality
        surplusFactor = 1 + Math.min((textLength - 500) / 1200, 0.28) * (0.5 + 0.5 * completionFactor);
      }

      // Performance scale: starts at 1.0 so base reward is the minimum.
      // perfect_accuracy benefits most from speed + consistency together.
      const perfAccScale =
        bonus.id === "perfect_accuracy"
          ? 1.0 + 0.40 * speedFactor * consistencyFactor        // 1.00 → 1.40
          : 1.0 + 0.18 * accuracyGate * consistencyFactor;      // 1.00 → 1.18

      const raw    = Math.round(bonus.xpReward * perfAccScale * surplusFactor);
      // Floor = base reward; ceiling = base × 1.40
      const reward = clamp(raw, bonus.xpReward, Math.round(bonus.xpReward * 1.40));

      totalXP += reward;
      xpEvents.push({ id: uuidv4(), text: bonus.name, value: reward, type: "bonus" });
    });

    // ── Mythic Bonuses (mutual exclusivity + hard caps) ───────────────────────
    let perfectStormFired = false;
    let mythicBonusXp = 0;

    // perfect_storm is checked first — if it fires it subsumes flawless_run + personal-best
    const perfectStormDef = MYTHIC_BONUSES.find((b) => b.id === "perfect_storm");
    if (perfectStormDef?.condition(session, targetWpm)) {
      perfectStormFired = true;
      const raw  = Math.round(maxBaseXP * 0.48 * speedFactor);
      const psXP = Math.min(raw, Math.round(maxBaseXP * 0.50), 500);
      if (psXP > 0) {
        totalXP       += psXP;
        mythicBonusXp += psXP;
        xpEvents.push({ id: uuidv4(), text: perfectStormDef.name, value: psXP, type: "mythic" });
      }
    }

    MYTHIC_BONUSES.forEach((bonus) => {
      if (bonus.id === "perfect_storm") return;                // already handled above
      if (bonus.id === "flawless_run" && perfectStormFired) return; // subsumed by perfect_storm
      if (!bonus.condition(session, targetWpm)) return;

      let xp = 0;
      if (bonus.id === "flawless_run") {
        const raw = Math.round(maxBaseXP * 0.35 * speedFactor * consistencyFactor);
        xp = Math.min(raw, Math.round(maxBaseXP * 0.38), 380);
      } else if (bonus.id === "speed_god") {
        const raw = Math.round(maxBaseXP * 0.50 * speedFactor);
        xp = Math.min(raw, Math.round(maxBaseXP * 0.52), 520);
      } else if (bonus.id === "eternal_precision") {
        const raw = Math.round(maxBaseXP * 0.42 * (0.5 + 0.5 * lengthFactor));
        xp = Math.min(raw, Math.round(maxBaseXP * 0.45), 450);
      }
      if (xp > 0) {
        totalXP       += xp;
        mythicBonusXp += xp;
        xpEvents.push({ id: uuidv4(), text: bonus.name, value: xp, type: "mythic" });
      }
    });

    // ── Personal Best Bonus ───────────────────────────────────────────────────
    if (!perfectStormFired && prevBestWpm > 0 && wpm > prevBestWpm) {
      const impRatio = (wpm - prevBestWpm) / prevBestWpm;
      let pbXP: number;
      if (impRatio < 0.05) {
        pbXP = Math.min(Math.round(maxBaseXP * 0.14), 140);
      } else if (impRatio < 0.15) {
        pbXP = Math.min(Math.round(maxBaseXP * 0.20 * speedFactor), 200);
      } else {
        pbXP = Math.min(Math.round(maxBaseXP * 0.28 * speedFactor), 280);
      }
      if (pbXP > 0) {
        totalXP += pbXP;
        xpEvents.push({ id: uuidv4(), text: "\u26a1 Personal Best", value: pbXP, type: "personal-best" });
      }
    }

    // ── Dispatch notifications ────────────────────────────────────────────────
    xpEvents.forEach((msg) => {
      if (msg.value > 0) addXPMessage?.(msg.text, msg.value, msg.type);
    });

    // ── Mythic/PB server-validation callback ──────────────────────────────────
    const hasMythicClaim = mythicBonusXp > 0;
    const hasPBClaim     = !perfectStormFired && prevBestWpm > 0 && wpm > prevBestWpm;
    if ((hasMythicClaim || hasPBClaim) && onMythicClaim) {
      onMythicClaim({
        isMythicClaim: hasMythicClaim,
        isPBClaim:     hasPBClaim,
        claimedWpm:    wpm,
        mythicBonusXp,
      });
    }

    // High-XP monitoring
    if (totalXP > 500 && process.env.NODE_ENV !== "test") {
      console.warn(
        JSON.stringify({
          type: "HIGH_XP_EVENT",
          userId,
          totalXP,
          sessionDetails: { wpm, accuracy: accuracyPct, textLength },
          timestamp: new Date().toISOString(),
        })
      );
    }

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
          wpm: Math.max(0, Number(session.wpm) || 0),
          accuracy: clamp(Number(session.accuracy) || 0, 0, 100),
          textLength: Math.max(1, Number(session.textLength) || 1),
        },
      }
    );
    return 0;
  }
};
