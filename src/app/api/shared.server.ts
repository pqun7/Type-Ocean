import 'server-only';
import { NextRequest } from "next/server";
import { redis, connectIfNeeded } from "@/lib/redis";
import prisma from "@/features/auth/lib/db";
import { getTodayDate, getUtcMidnightTTL } from "@/features/auth/utils/timeUtils";
import { logging } from "@/log/ServerLogger";
import { getToken } from "next-auth/jwt";

export type AuthorizedAdminActor = {
  id: string;
  username: string;
  email: string;
  role: string;
  isPrimaryAdmin: boolean;
};

const extractTokenUserId = (token: { id?: unknown; sub?: string | null } | null | undefined) => {
  const tokenId = typeof token?.id === "string" ? token.id : undefined;
  return tokenId ?? token?.sub ?? null;
};

export const resolveExistingUserId = async (userId: string | null | undefined): Promise<string | null> => {
  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, banned: true },
  });

  if (!user || user.banned) {
    return null;
  }

  return user.id;
};

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
      return resolveExistingUserId(headerUserId);
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

    const userId = extractTokenUserId(token);
    const existingUserId = await resolveExistingUserId(userId);

    if (userId && !existingUserId) {
      logging.warn("Rejecting authenticated request for missing or banned user", {
        path: req.nextUrl.pathname,
        userId,
      });
    }

    return existingUserId;
  } catch {
    return null;
  }
};

export const authorizeAdminRequest = async (req: NextRequest): Promise<string | null> => {
  const actor = await authorizeAdminActor(req);
  return actor?.id ?? null;
};

export const authorizeAdminActor = async (req: NextRequest): Promise<AuthorizedAdminActor | null> => {
  const userId = await authorizeRequest(req);
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isPrimaryAdmin: true,
    },
  });

  if (!user || user.role !== "admin") {
    return null;
  }

  return user;
};

export const authorizePrimaryAdminRequest = async (req: NextRequest): Promise<AuthorizedAdminActor | null> => {
  const actor = await authorizeAdminActor(req);
  if (!actor?.isPrimaryAdmin) {
    return null;
  }

  return actor;
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