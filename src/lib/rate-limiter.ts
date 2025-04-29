// src/lib/rate-limiter.ts
import { prisma } from "@/lib/db";
import { cacheRequest } from "@/lib/cache";

const RATE_LIMIT = {
  REQUESTS_PER_PERIOD: 3,
  PERIOD_MS: 60 * 2000,
};

export async function checkRateLimit(ip: string): Promise<boolean> {
  if (!cacheRequest(ip)) {
    console.warn(`Cache request check failed for IP: ${ip}`);
    return false;
  }

  try {
    let rateLimit = await prisma.rateLimit.findUnique({
      where: { ip },
    });

    const now = new Date();
    const currentTime = now.getTime();

    if (rateLimit) {
      const timeSinceLastUpdate = currentTime - rateLimit.lastUpdated.getTime();
      if (timeSinceLastUpdate > RATE_LIMIT.PERIOD_MS) {
        rateLimit = await prisma.rateLimit.update({
          where: { ip },
          data: { count: 1, lastUpdated: now },
        });
      } else {
        rateLimit = await prisma.rateLimit.update({
          where: { ip },
          data: { count: { increment: 1 } },
        });
      }
    } else {
      rateLimit = await prisma.rateLimit.create({
        data: { ip, count: 1, lastUpdated: now },
      });
    }

    return rateLimit.count <= RATE_LIMIT.REQUESTS_PER_PERIOD;
  } catch (error) {
    console.error(`Rate limit check failed for IP: ${ip}`, error);
    return true;
  }
}