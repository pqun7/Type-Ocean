// src/lib/rate-limiter.ts
import 'server-only'; // Add this line at the top

import prisma from "@/lib/db";
import { cacheRequest } from "@/lib/cache";
import * as Sentry from '@sentry/nextjs';
import redis from "@/lib/redis";
import { logging } from "@/log/ServerLogger"; 

const RATE_LIMIT = {
  REQUESTS_PER_PERIOD: 3,
  PERIOD_MS: 60 * 2000,
};

// src/lib/rate-limiter.ts
export async function checkRateLimit(ip: string): Promise<boolean> {
  const redisKey = `rateLimit:${ip}`;
  const current = await redis.get(redisKey);
  logging.debug(`[RATE] Checking limit for IP: ${ip}`);

  if (current) {
    const { count, timestamp } = JSON.parse(current);
    const timeDiff = Date.now() - timestamp;
    logging.debug(`[RATE] Current count: ${count} for IP: ${ip}`);
    logging.debug(
      `[RATE] Time since last request: ${timeDiff}ms for IP: ${ip}`
    );

    if (timeDiff > RATE_LIMIT.PERIOD_MS) {
      await redis.set(
        redisKey,
        JSON.stringify({ count: 1, timestamp: Date.now() })
      );
      return true;
    }

    if (count >= RATE_LIMIT.REQUESTS_PER_PERIOD) {
      logging.warn(
        `[RATE] Rate limit exceeded for IP: ${ip}. Count: ${count}`
      );
      // Optionally, you can also block the request here
      return false;
      // Or you can just return false to indicate the limit is reached
      // and the request should not be processed further  
    }

    await redis.set(
      redisKey,
      JSON.stringify({
        count: count + 1,
        timestamp,
      })
    );
    logging.debug(`[RATE] Incremented count to ${count + 1} for IP: ${ip}`);

    return true;
  }

  await redis.set(
    redisKey,
    JSON.stringify({
      count: 1,
      timestamp: Date.now(),
    })
  );
  return true;
}
