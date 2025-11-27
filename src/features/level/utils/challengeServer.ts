import 'server-only';
import type { DailyChallenge, SessionData } from "@/features/level/types/level";
import { UPDATE_CHALLENGE_SCRIPT } from "@/constants/atomic";

export async function atomicChallengeUpdate(
  userId: string,
  progress: SessionData,
  operation: "increment" | "replace"
): Promise<DailyChallenge> {
  // Import server-only helpers
  const { redis, getCacheKey, getTodayDate, getCacheTTL } = await import("@/app/api/shared.server");

  const key = getCacheKey(userId);
  const today = getTodayDate();
  const ttl = getCacheTTL();

  const result = await redis.eval(
    UPDATE_CHALLENGE_SCRIPT,
    1,
    key,
    JSON.stringify(progress),
    operation,
    today,
    ttl.toString()
  );

  if (result === false) {
    throw new Error("Challenge not found");
  }
  if (result === "expired") {
    throw new Error("Challenge expired");
  }

  return JSON.parse(result as string);
}

export const challengeOperations = {
  // Use Redis HINCRBY for numeric fields where possible
  incrementProgress: async (userId: string, updates: Partial<SessionData>) => {
    const { redis, getCacheKey } = await import("@/app/api/shared.server");

    const key = getCacheKey(userId);
    const pipeline = redis.pipeline();
    
    Object.entries(updates).forEach(([field, value]) => {
      if (typeof value === 'number') {
        pipeline.hincrby(`${key}:progress`, field, value);
      }
    });
    
    await pipeline.exec();
  },
  
  // CAS (Compare-and-Set) pattern for complex updates
  updateWithCAS: async (userId: string, updater: (challenge: DailyChallenge) => DailyChallenge) => {
    const { redis, getCacheKey, getCacheTTL } = await import("@/app/api/shared.server");

    const key = getCacheKey(userId);
    const maxAttempts = 3;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await redis.watch(key);
      const current = await redis.get(key);
      
      if (!current) throw new Error('Challenge not found');
      
      const updated = updater(JSON.parse(current));
      const multi = redis.multi();
      
      multi.setex(key, getCacheTTL(), JSON.stringify(updated));
      
      try {
        const results = await multi.exec();
        if (results) return updated;
      } catch (error) {
        // CAS conflict, retry
        if (attempt === maxAttempts - 1) throw error;
      }
    }
    
    throw new Error('Failed to update challenge after retries');
  }
};