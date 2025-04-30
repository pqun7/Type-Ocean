// src/lib/rate-limiter.ts
import { prisma } from "@/lib/db";
import { cacheRequest } from "@/lib/cache";

const RATE_LIMIT = {
  REQUESTS_PER_PERIOD: 3,
  PERIOD_MS: 60 * 2000,
};

export async function checkRateLimit(ip: string): Promise<boolean> {
  console.log(`Checking rate limit for IP: ${ip}`);

  if (!cacheRequest(ip)) {
    console.warn(`⚠️ Cache request check failed for IP: ${ip}`);
    return false;
  }

  try {
    let rateLimit = await prisma.rateLimit.findUnique({
      where: { ip },
    });

    const now = new Date();
    const currentTime = now.getTime();

    if (rateLimit) {
      console.log(`ℹ️ Existing rate limit found for IP: ${ip} with count: ${rateLimit.count}`);

      const timeSinceLastUpdate = currentTime - rateLimit.lastUpdated.getTime();
      console.log(`⏱ Time since last update: ${timeSinceLastUpdate} ms`);

      if (timeSinceLastUpdate > RATE_LIMIT.PERIOD_MS) {
        console.log(`🔄 Rate limit period expired. Resetting count for IP: ${ip}`);
        rateLimit = await prisma.rateLimit.update({
          where: { ip },
          data: { count: 1, lastUpdated: now },
        });
      } else {
        console.log(`➕ Incrementing count for IP: ${ip}`);
        rateLimit = await prisma.rateLimit.update({
          where: { ip },
          data: { count: { increment: 1 } },
        });
      }
    } else {
      console.log(`🆕 No rate limit record found. Creating new record for IP: ${ip}`);
      rateLimit = await prisma.rateLimit.create({
        data: { ip, count: 1, lastUpdated: now },
      });
    }

    const allowed = rateLimit.count <= RATE_LIMIT.REQUESTS_PER_PERIOD;
    console.log(`✅ IP: ${ip} has made ${rateLimit.count} requests. Allowed: ${allowed}`);

    return allowed;
  } catch (error) {
    console.error(`❌ Rate limit check failed for IP: ${ip}`, error);
    return true; // Let requests through if there's an error
  }
}
