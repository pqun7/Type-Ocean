import { NextRequest } from "next/server";
import { redis, connectIfNeeded } from "@/lib/redis";
import { getTodayDate, getLocalMidnightTTL } from "@/features/auth/utils/timeUtils";
import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";

// Expose a TTL getter so routes can evaluate it at runtime
export const getCacheTTL = () =>
  process.env.NODE_ENV === "development" ? 60 : getLocalMidnightTTL();

export const getCacheKey = (userId: string) =>
  `dailyChallenge:${userId}:${getTodayDate()}`;

export const authorizeRequest = (req: NextRequest) => {
  const userId = req.headers.get("x-user-id");
  const authHeader = req.headers.get("authorization");

  if (!userId) return false;

  // Validate internal requests
  if (typeof window === "undefined" &&
      authHeader !== `Bearer ${process.env.API_INTERNAL_SECRET}`) {
    return false;
  }

  return userId;
};

export { redis, connectIfNeeded, getTodayDate, logRequestStart, logRequestSuccess, logRequestError };
