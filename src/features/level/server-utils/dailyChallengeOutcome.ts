import "server-only";

import type { DailyChallenge } from "@/features/level/types/level";
import { connectIfNeeded, redis } from "@/app/api/shared.server";
import { updateDailyChallengeStreakOnCompletion } from "@/features/level/server-utils/dailyChallengeStreak";

export type LastChallengeOutcome = {
  date: string; // YYYY-MM-DD
  type: DailyChallenge["type"];
  status: DailyChallenge["status"]; // 1 when recorded (completed)
  attempts?: number;
  target?: DailyChallenge["target"];
  completedAt?: string;
  streak: number;
  lastCompletedDate: string; // YYYY-MM-DD
};

const OUTCOME_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

function outcomeKey(userId: string): string {
  return `user:dailyChallenge:outcome:${userId}`;
}

export async function getLastChallengeOutcome(userId: string): Promise<LastChallengeOutcome | null> {
  await connectIfNeeded();
  const raw = await redis.get(outcomeKey(userId)).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LastChallengeOutcome;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.date !== "string" || typeof parsed.type !== "string") return null;
    if (typeof parsed.streak !== "number" || typeof parsed.lastCompletedDate !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function recordChallengeOutcomeIfCompleted(
  userId: string,
  challenge: DailyChallenge
): Promise<void> {
  // Only record completions to keep the signal clean.
  if (challenge.status !== 1) return;
  if (!challenge.date) return;

  await connectIfNeeded();

  const prev = await getLastChallengeOutcome(userId);
  // If we already recorded today's completion, do nothing.
  if (prev?.date === challenge.date && prev?.status === 1) return;

  const streakState = await updateDailyChallengeStreakOnCompletion(userId, challenge.date);

  const attempts =
    challenge.type === "speedCombo" && challenge.data && typeof challenge.data.attempts === "number"
      ? challenge.data.attempts
      : undefined;

  const completedAt =
    challenge.type === "speedCombo" && challenge.data && typeof challenge.data.completedAt === "string"
      ? challenge.data.completedAt
      : undefined;

  const payload: LastChallengeOutcome = {
    date: challenge.date,
    type: challenge.type,
    status: 1,
    attempts,
    target: challenge.target,
    completedAt,
    streak: streakState.streak,
    lastCompletedDate: streakState.lastCompletedDate,
  };

  await redis.setex(outcomeKey(userId), OUTCOME_TTL_SECONDS, JSON.stringify(payload));
}
