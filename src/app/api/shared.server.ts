import 'server-only';
import { NextRequest } from "next/server";
import { redis, connectIfNeeded } from "@/lib/redis";
import { getTodayDate, getUtcMidnightTTL } from "@/features/auth/utils/timeUtils";
import { logging } from "@/log/ServerLogger";
import { getToken } from "next-auth/jwt";

// Expose a TTL getter so routes can evaluate it at runtime
export const getCacheTTL = () =>
  process.env.NODE_ENV === "development"
    ? Math.min(60 * 60, getUtcMidnightTTL())
    : getUtcMidnightTTL();

export const getCacheKeyForDate = (userId: string, date: string) =>
  `dailyChallenge:${userId}:${date}`;

export const getChallengeIdKey = (challengeId: string) =>
  `dailyChallengeById:${challengeId}`;

export const getCacheKey = (userId: string) =>
  getCacheKeyForDate(userId, getTodayDate());

export const authorizeRequest = async (req: NextRequest): Promise<string | null> => {
  const headerUserId = req.headers.get("x-user-id");
  const authHeader = req.headers.get("authorization");
  const internalSecret = process.env.API_INTERNAL_SECRET;

  // Internal service-to-service calls: must include both user header + secret
  if (headerUserId) {
    if (internalSecret && authHeader === `Bearer ${internalSecret}`) {
      return headerUserId;
    }
    // Reject spoofable headers without a valid internal secret
    return null;
  }

  // External (browser) calls: rely on NextAuth cookies/JWT
  try {
    const token = await getToken({
      req,
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    });

    const userId = (token?.id as string | undefined) ?? token?.sub;
    return userId ?? null;
  } catch {
    return null;
  }
};

// Safe logging utilities for auth operations
export const logAuthOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Auth operation started: ${operation}`, metadata || {});
  },
  
  success: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Auth operation completed: ${operation}`, metadata || {});
  },
  
  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Auth operation failed: ${operation}`, error, metadata);
  }
};

export { redis, connectIfNeeded, getTodayDate };