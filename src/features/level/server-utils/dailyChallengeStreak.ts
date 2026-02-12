import "server-only";

import { connectIfNeeded, redis } from "@/app/api/shared.server";

export type DailyChallengeStreakState = {
  streak: number;
  lastCompletedDate: string; // YYYY-MM-DD
};

// Keep streak around for a long time even if the user is inactive.
const STREAK_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

function streakKey(userId: string): string {
  return `user:dailyChallenge:streak:${userId}`;
}

function parseIsoDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isoDateAddDays(date: string, deltaDays: number): string {
  const d = parseIsoDate(date);
  if (!d) return date;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function getDailyChallengeStreak(userId: string): Promise<DailyChallengeStreakState | null> {
  await connectIfNeeded();
  const raw = await redis.get(streakKey(userId)).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DailyChallengeStreakState;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.streak !== "number" || parsed.streak < 0) return null;
    if (typeof parsed.lastCompletedDate !== "string") return null;
    return {
      streak: Math.floor(parsed.streak),
      lastCompletedDate: parsed.lastCompletedDate,
    };
  } catch {
    return null;
  }
}

/**
 * Update streak on a completion for `completedDate`.
 * - If already completed today: streak unchanged.
 * - If completed yesterday too: streak++
 * - Else: streak resets to 1.
 */
export async function updateDailyChallengeStreakOnCompletion(
  userId: string,
  completedDate: string
): Promise<DailyChallengeStreakState> {
  await connectIfNeeded();

  const prev = await getDailyChallengeStreak(userId);

  // Idempotency: don't increment multiple times for the same day.
  if (prev?.lastCompletedDate === completedDate) {
    const keep = {
      streak: Math.max(1, Math.floor(prev.streak)),
      lastCompletedDate: prev.lastCompletedDate,
    };
    await redis.setex(streakKey(userId), STREAK_TTL_SECONDS, JSON.stringify(keep));
    return keep;
  }

  const yesterday = isoDateAddDays(completedDate, -1);
  const nextStreak = prev?.lastCompletedDate === yesterday ? Math.max(1, Math.floor(prev.streak) + 1) : 1;

  const next: DailyChallengeStreakState = {
    streak: nextStreak,
    lastCompletedDate: completedDate,
  };

  await redis.setex(streakKey(userId), STREAK_TTL_SECONDS, JSON.stringify(next));
  return next;
}
