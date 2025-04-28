// src/lib/cache.ts
import NodeCache from "node-cache";
const RATE_LIMIT = {
  REQUESTS_PER_PERIOD: 3,
  PERIOD_MS: 60 * 1000, // 1 دقيقة
};
const requestCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

export function cacheRequest(ip: string): boolean {
  const count = requestCache.get<number>(ip) || 0;
  requestCache.set(ip, count + 1);
  return count < RATE_LIMIT.REQUESTS_PER_PERIOD;
}
