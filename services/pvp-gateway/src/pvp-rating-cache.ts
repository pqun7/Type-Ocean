import type { RedisBus } from "./redis-bus";

function getPvpSelfCacheKey(userId: string) {
  return `pvp:self:${userId}`;
}

export async function invalidatePvpSelfCaches(redis: RedisBus["redis"] | null, userIds: string[]) {
  if (!redis || userIds.length === 0) return;

  try {
    await redis.del(...Array.from(new Set(userIds)).map(getPvpSelfCacheKey));
  } catch {
    // ignore
  }
}
