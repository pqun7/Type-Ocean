import type { PrismaClient } from "@prisma/client";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

export type PlayerSkillEstimate = {
  avgWpm: number;
  bestWpm: number;
  avgAccuracy: number;
};

export async function estimatePlayerSkill(prisma: PrismaClient, userId: string): Promise<PlayerSkillEstimate> {
  const profile = await prisma.playerProfile.findUnique({
    where: { userId },
    select: { longTermStats: true },
  });

  const longTerm: Record<string, unknown> | null =
    profile?.longTermStats && typeof profile.longTermStats === "object"
      ? (profile.longTermStats as Record<string, unknown>)
      : null;

  const longAvgWpm = safeNumber(longTerm?.averageWPM) ?? 45;
  const longBestWpm = safeNumber(longTerm?.bestWPM) ?? Math.max(longAvgWpm + 10, 60);
  const longAvgAcc = safeNumber(longTerm?.averageAccuracy) ?? 95;

  const recent = await prisma.dailyTypingActivity.findMany({
    where: { userId },
    orderBy: { localDate: "desc" },
    take: 14,
    select: { totalTimeSpentSec: true, sumWpmTime: true, sumAccuracy: true },
  });

  let recentAvgWpm = longAvgWpm;
  let recentAvgAcc = longAvgAcc;

  const totalRecentTime = recent.reduce((acc, r) => acc + (r.totalTimeSpentSec ?? 0), 0);
  if (totalRecentTime > 60) {
    const sumWpmTime = recent.reduce((acc, r) => acc + (r.sumWpmTime ?? 0), 0);
    const sumAcc = recent.reduce((acc, r) => acc + (r.sumAccuracy ?? 0), 0);

    recentAvgWpm = sumWpmTime > 0 ? sumWpmTime / Math.max(1, totalRecentTime) : longAvgWpm;
    // sumAccuracy is "sum of accuracy%" per session (not time-weighted) in this table.
    // We approximate recent accuracy by averaging across days with activity.
    const activeDays = recent.filter((r) => (r.totalTimeSpentSec ?? 0) > 0).length;
    recentAvgAcc = activeDays > 0 ? sumAcc / activeDays : longAvgAcc;
  }

  const avgWpm = clamp(Math.round(0.6 * recentAvgWpm + 0.4 * longAvgWpm), 10, 220);
  const bestWpm = clamp(Math.round(longBestWpm), avgWpm, 260);
  const avgAccuracy = clamp(Number((0.6 * recentAvgAcc + 0.4 * longAvgAcc).toFixed(1)), 70, 100);

  return { avgWpm, bestWpm, avgAccuracy };
}

export type AiProfile = {
  // The baseline WPM target when playing "fair".
  targetWpm: number;
  // Approximate accuracy (used to compute plausible errors, though UI does not show AI input).
  accuracyPct: number;
  // How much the AI speed can wobble around the target.
  volatility: number;
};

export function createAiProfile(skill: PlayerSkillEstimate, seed: number): AiProfile {
  // Slightly challenging but beatable.
  const bonus = 1.03 + ((seed % 6) / 100); // 1.03 .. 1.08
  const raw = skill.avgWpm * bonus;

  // Never exceed near-best.
  const capped = Math.min(raw, skill.bestWpm * 0.97);
  const targetWpm = clamp(Math.round(capped), 15, 240);

  // Make accuracy slightly below player's typical accuracy.
  const accuracyPct = clamp(Number((skill.avgAccuracy - 1.5).toFixed(1)), 80, 99.5);

  const volatility = clamp(0.08 + ((seed % 7) / 100), 0.08, 0.18);

  return { targetWpm, accuracyPct, volatility };
}

export function ratingFromWpm(wpm: number) {
  // Rough mapping for an AI opponent.
  // 40 WPM ~ 1200, 80 WPM ~ 1500, 120 WPM ~ 1800, 160 WPM ~ 2100
  const r = 900 + wpm * 7.5;
  return clamp(Math.round(r), 800, 2600);
}

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
