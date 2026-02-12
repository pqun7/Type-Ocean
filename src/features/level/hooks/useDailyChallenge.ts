// useDailyChallenge.ts
"use client";

import { useEffect, useState } from "react";
import { DailyChallenge } from "../types/level";
import { fetchDailyChallenge } from "@/features/level/services/dailyChallengeService";
import { logger } from "@/log/clientLogger";
import { getTodayDate, getUtcMidnightTTL } from "@/features/auth/utils/timeUtils";

/**
 * Hook for loading and managing daily challenge data
 * @param userId - Current user identifier
 * @returns Daily challenge state and loading status
 */
export const useDailyChallengeLoader = (
  userId?: string,
  bootstrapChallenge?: DailyChallenge | null,
  isBootstrapping?: boolean
) => {
  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(null);

  // Keep a stable "today" key so we can refresh the challenge at UTC midnight without a page reload.
  const [todayKey, setTodayKey] = useState(() => getTodayDate());

  useEffect(() => {
    const ttlSeconds = getUtcMidnightTTL();
    // Add a small buffer to avoid edge-of-midnight race conditions.
    const timeoutId = window.setTimeout(() => {
      setTodayKey(getTodayDate());
    }, (ttlSeconds + 2) * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [todayKey]);

  useEffect(() => {
    const abortController = new AbortController();
    const requestId = (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
    })();

    const today = todayKey;

    const readCachedChallenge = (id: string) => {
      try {
        const raw = localStorage.getItem(`user:${id}:dailyChallenge:${today}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DailyChallenge;
        if (parsed && typeof parsed === "object" && parsed.date === today && typeof parsed.id === "string") {
          return parsed;
        }
        return null;
      } catch {
        return null;
      }
    };

    const writeCachedChallenge = (id: string, challenge: DailyChallenge) => {
      try {
        if (!challenge?.date) return;
        localStorage.setItem(
          `user:${id}:dailyChallenge:${challenge.date}`,
          JSON.stringify({ ...challenge, cachedAt: Date.now() })
        );
      } catch {
        // ignore
      }
    };

    const scheduleIdle = (fn: () => void) => {
      if (typeof window === "undefined") return { cancel: () => {} };
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };

      if (typeof w.requestIdleCallback === "function") {
        const idleId = w.requestIdleCallback(fn, { timeout: 1500 });
        return { cancel: () => w.cancelIdleCallback?.(idleId) };
      }

      const timeoutId = window.setTimeout(fn, 250);
      return { cancel: () => window.clearTimeout(timeoutId) };
    };

    const loadChallenge = async () => {
      if (!userId) {
        setDailyChallenge(null);
        return;
      }

      // Avoid showing (or even hydrating) challenge text before bootstrap finishes.
      // This prevents a flash where cached/standalone challenge appears, then gets
      // replaced once /api/home/bootstrap arrives.
      if (isBootstrapping) return;

      // If the day changed, clear previous value so the header icon doesn't show yesterday's progress.
      setDailyChallenge(null);

      // Bootstrap path: server already provided today's challenge
      if (bootstrapChallenge && bootstrapChallenge.date === today) {
        setDailyChallenge(bootstrapChallenge);
        writeCachedChallenge(userId, bootstrapChallenge);
        return;
      }

      // Fast path: paint cached challenge immediately
      const cached = readCachedChallenge(userId);
      if (cached) {
        setDailyChallenge(cached);
      }

      try {
        logger.challenge.info("Loading daily challenge" ,{ requestId, userId });
        const challenge = await fetchDailyChallenge(userId, abortController, requestId);
        setDailyChallenge(challenge);
        writeCachedChallenge(userId, challenge);
      } catch (error) {
        // Error handling and logging
        if (error instanceof Error) {
          logger.challenge.error("Failed to load challenge", error);
        } else {
          logger.challenge.error("Failed to load challenge", new Error(String(error)));
        }
        // Keep cached value if present; otherwise reset.
        setDailyChallenge((prev) => prev ?? null);
      }
    };

    const idleHandle = scheduleIdle(() => {
      loadChallenge();
    });

    return () => {
      idleHandle.cancel();
      abortController.abort();
    };
  }, [userId, bootstrapChallenge, isBootstrapping, todayKey]);

  return { dailyChallenge };
};