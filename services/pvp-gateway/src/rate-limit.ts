export type TokenBucket = {
  capacity: number;
  tokens: number;
  refillPerMs: number;
  lastRefillMs: number;
};

export function createTokenBucket(params: { capacity: number; refillPerSec: number; nowMs: number }): TokenBucket {
  const capacity = Math.max(1, Math.floor(params.capacity));
  const refillPerSec = Math.max(0, params.refillPerSec);
  return {
    capacity,
    tokens: capacity,
    refillPerMs: refillPerSec / 1000,
    lastRefillMs: params.nowMs,
  };
}

export function refill(bucket: TokenBucket, nowMs: number) {
  const dt = Math.max(0, nowMs - bucket.lastRefillMs);
  if (dt <= 0) return;
  bucket.lastRefillMs = nowMs;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + dt * bucket.refillPerMs);
}

export function tryConsume(bucket: TokenBucket, cost: number, nowMs: number): boolean {
  refill(bucket, nowMs);
  const c = Math.max(0, cost);
  if (bucket.tokens < c) return false;
  bucket.tokens -= c;
  return true;
}
