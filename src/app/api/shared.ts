import { NextRequest } from "next/server";

// Client-safe utilities only
export const getCacheTTL = () => {
  // This is a client-safe version that returns a default
  // The actual implementation is in shared.server.ts
  return process.env.NODE_ENV === "development" ? 60 : 86400; // 24 hours in seconds
};

export const getCacheKey = (userId: string) => {
  const today = new Date().toISOString().split('T')[0];
  return `dailyChallenge:${userId}:${today}`;
};

export const authorizeRequest = (req: NextRequest) => {
  const userId = req.headers.get("x-user-id");
  const authHeader = req.headers.get("authorization");

  if (!userId) return false;

  // Validate internal requests - this will only run on server
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
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}

// Safe logging utilities for auth operations
export const logAuthOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    console.log(`Auth operation started: ${operation}`, metadata || {});
  },
  
  success: (operation: string, metadata?: Record<string, unknown>) => {
    console.log(`Auth operation completed: ${operation}`, metadata || {});
  },
  
  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    console.error(`Auth operation failed: ${operation}`, error, metadata);
  }
};