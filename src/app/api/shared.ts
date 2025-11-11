// shared.ts
import { NextRequest } from "next/server";
import { redis, connectIfNeeded } from "@/lib/redis";
import { getTodayDate, getLocalMidnightTTL } from "@/features/auth/utils/timeUtils";
import { logging } from "@/log/ServerLogger";


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

// Enhanced authFetch for client-side
export async function clientAuthFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  // Client-side should rely on session cookies, not user ID headers
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Include session cookies
  });

  if (!response.ok) {
    // Handle errors...
  }
  
  return response.json();
}


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

export { redis, connectIfNeeded, getTodayDate};
