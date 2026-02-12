import "server-only";

import { v4 as uuidv4 } from "uuid";

import type { DailyChallenge } from "@/features/level/types/level";
import { generateDailyChallenge } from "@/features/level/utils/challengeHelpers";
import { getUserLevel } from "@/features/level/server-utils/userCache";
import { getLongTermCumulativeStats } from "@/helper/session-stats";
import { getLastChallengeOutcome } from "@/features/level/server-utils/dailyChallengeOutcome";
import { getDailyChallengeStreak } from "@/features/level/server-utils/dailyChallengeStreak";
import {
  connectIfNeeded,
  getCacheKey,
  getCacheTTL,
  getChallengeIdKey,
  getTodayDate,
  redis,
} from "@/app/api/shared.server";

const FALLBACK_TTL_SECONDS = 300;

const generateDefaultChallenge = async (): Promise<DailyChallenge> => {
  const today = getTodayDate();
  return {
    id: uuidv4(),
    date: today,
    type: "speedCombo",
    target: { wpm: 60, accuracy: 95 },
    xp: 100,
    difficulty: 1,
    status: 0,
    data: {},
  };
};

export async function getOrCreateDailyChallenge(userId: string): Promise<DailyChallenge> {
  await connectIfNeeded();

  const cacheKey = getCacheKey(userId);
  const cacheTTL = getCacheTTL();

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    const parsed = JSON.parse(cached) as DailyChallenge;

    // Ensure an ID-indexed key exists so updates by challengeId keep working.
    try {
      const ttlSeconds = await redis.ttl(cacheKey).catch(() => -1);
      const ttlToUse = ttlSeconds > 0 ? ttlSeconds : cacheTTL;
      await redis.setex(getChallengeIdKey(parsed.id), ttlToUse, cached);
    } catch {
      // Best-effort only
    }

    return parsed;
  }

  let userLevel: number | null = null;
  try {
    userLevel = await getUserLevel(userId);
  } catch {
    userLevel = null;
  }

  if (!userLevel) {
    const fallback = await generateDefaultChallenge();
    await redis.setex(cacheKey, FALLBACK_TTL_SECONDS, JSON.stringify(fallback));
    return fallback;
  }

  let stats: Awaited<ReturnType<typeof getLongTermCumulativeStats>> | null = null;
  try {
    stats = await getLongTermCumulativeStats(userId);
  } catch {
    stats = null;
  }

  const [lastOutcome, streak] = await Promise.all([
    getLastChallengeOutcome(userId).catch(() => null),
    getDailyChallengeStreak(userId).catch(() => null),
  ]);

  const challenge = await generateDailyChallenge(
    userId,
    userLevel,
    stats
      ? {
          averageWPM: stats.averageWPM,
          averageAccuracy: stats.averageAccuracy,
          bestWPM: stats.bestWPM,
          bestAccuracy: stats.bestAccuracy,
          totalSessions: stats.totalSessions,
          totalTimeTyped: stats.totalTimeTyped,
          totalCharactersTyped: stats.totalCharactersTyped,
          lastUpdated: stats.lastUpdated,
          streak: streak?.streak,
          lastOutcome: lastOutcome
            ? {
                date: lastOutcome.date,
                type: lastOutcome.type,
                status: lastOutcome.status,
                attempts: lastOutcome.attempts,
                streak: lastOutcome.streak,
              }
            : undefined,
        }
      : undefined
  );
  const payload = JSON.stringify(challenge);

  await redis
    .multi()
    .setex(cacheKey, cacheTTL, payload)
    .setex(getChallengeIdKey(challenge.id), cacheTTL, payload)
    .exec();

  return challenge;
}
