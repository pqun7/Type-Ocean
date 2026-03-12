import type Redis from "ioredis";

type RedisLike = Pick<Redis, "get" | "set" | "del">;

type MemoryEntry = {
  value: string;
  expiresAt: number;
};

const memoryStore = new Map<string, MemoryEntry>();

function getMemoryValue(key: string) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

async function setMemoryValue(key: string, value: string, ttlSeconds: number) {
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function readJsonValue<T>(redis: RedisLike | null | undefined, key: string): Promise<T | null> {
  const raw = redis ? await redis.get(key) : getMemoryValue(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonValue(redis: RedisLike | null | undefined, key: string, value: unknown, ttlSeconds: number) {
  const serialized = JSON.stringify(value);
  if (redis) {
    await redis.set(key, serialized, "EX", ttlSeconds);
    return;
  }

  await setMemoryValue(key, serialized, ttlSeconds);
}

export async function deleteValue(redis: RedisLike | null | undefined, key: string) {
  if (redis?.del) {
    await redis.del(key);
    return;
  }
  memoryStore.delete(key);
}

export type { RedisLike };