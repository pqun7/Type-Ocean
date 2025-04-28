// src/lib/cleanup-rate-limits.ts
import { prisma } from "@/lib/db";

export async function cleanupRateLimits() {
  await prisma.rateLimit.deleteMany({
    where: {
      lastUpdated: {
        lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 ساعة
      }
    }
  });
}