import type Redis from "ioredis";

import type { ServerMessage } from "./protocol";

export type IdempotencyRecord = {
  response?: {
    type: ServerMessage["type"];
    payload: unknown;
  } | null;
  processedSeq?: number | null;
};

type StoredEntry = {
  value: IdempotencyRecord;
  expiresAt: number;
};

export class InMemoryIdempotencyStore {
  private readonly entries = new Map<string, StoredEntry>();

  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: IdempotencyRecord, ttlSeconds: number, now = Date.now()) {
    this.entries.set(key, {
      value,
      expiresAt: now + ttlSeconds * 1000,
    });
  }
}

export function buildIdempotencyKey(userId: string, messageType: string, requestId: string) {
  return `pvp:idempotency:${userId}:${messageType}:${requestId}`;
}

export function getIdempotencyTtlSeconds(messageType: string) {
  return messageType === "INPUT_UPDATE" ? 60 : 300;
}

export async function getIdempotencyRecord(params: {
  redis: Redis | null;
  store: InMemoryIdempotencyStore;
  key: string;
}) {
  if (!params.redis) {
    return params.store.get(params.key);
  }

  const raw = await params.redis.get(params.key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as IdempotencyRecord;
  } catch {
    return null;
  }
}

export async function setIdempotencyRecord(params: {
  redis: Redis | null;
  store: InMemoryIdempotencyStore;
  key: string;
  value: IdempotencyRecord;
  ttlSeconds: number;
}) {
  if (!params.redis) {
    params.store.set(params.key, params.value, params.ttlSeconds);
    return;
  }

  await params.redis.set(params.key, JSON.stringify(params.value), "EX", params.ttlSeconds);
}