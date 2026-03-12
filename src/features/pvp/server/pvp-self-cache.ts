import { connectIfNeeded, redis } from "@/lib/redis";

const PVP_SELF_CACHE_TTL_SECONDS = 30;

type RedisLike = {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

type CachedPvpSelfPayload = {
  v: 1;
  rating: number;
  deviation: number;
  gamesPlayed: number;
  updatedAt: string;
  rank: unknown;
  classified: boolean;
};

export type PvpSelfResponse = Omit<CachedPvpSelfPayload, "v">;

export function getPvpSelfCacheKey(userId: string) {
  return `pvp:self:${userId}`;
}

async function withRedis<T>(fn: (client: RedisLike) => Promise<T>) {
  try {
    await connectIfNeeded();
    return await fn(redis as unknown as RedisLike);
  } catch {
    return null;
  }
}

export async function readCachedPvpSelf(userId: string, redisClient?: RedisLike): Promise<PvpSelfResponse | null> {
  const reader = async (client: RedisLike) => {
    const raw = await client.get(getPvpSelfCacheKey(userId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<CachedPvpSelfPayload>;
      if (parsed.v !== 1) return null;
      if (typeof parsed.rating !== "number") return null;
      if (typeof parsed.deviation !== "number") return null;
      if (typeof parsed.gamesPlayed !== "number") return null;
      if (typeof parsed.updatedAt !== "string") return null;
      if (typeof parsed.classified !== "boolean") return null;

      return {
        rating: parsed.rating,
        deviation: parsed.deviation,
        gamesPlayed: parsed.gamesPlayed,
        updatedAt: parsed.updatedAt,
        rank: parsed.rank,
        classified: parsed.classified,
      };
    } catch {
      return null;
    }
  };

  if (redisClient) {
    return reader(redisClient);
  }

  return withRedis(reader);
}

export async function writeCachedPvpSelf(userId: string, payload: PvpSelfResponse, redisClient?: RedisLike) {
  const writer = async (client: RedisLike) => {
    await client.setex(
      getPvpSelfCacheKey(userId),
      PVP_SELF_CACHE_TTL_SECONDS,
      JSON.stringify({ v: 1, ...payload } satisfies CachedPvpSelfPayload)
    );
  };

  if (redisClient) {
    await writer(redisClient);
    return;
  }

  await withRedis(writer);
}

export async function invalidateCachedPvpSelf(userId: string, redisClient?: RedisLike) {
  const invalidator = async (client: RedisLike) => {
    await client.del(getPvpSelfCacheKey(userId));
  };

  if (redisClient) {
    await invalidator(redisClient);
    return;
  }

  await withRedis(invalidator);
}
