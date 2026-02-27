// useSessionXP.ts
"use client";

import { useReducer, useCallback, useEffect, useRef } from "react";
import { levelReducer } from "../reducers/levelReducer";
import { calculateSessionXP } from "../utils/xpCalculations";
import { calculateNextLevelXP } from "../utils/xpMath";
import { logger } from "@/log/clientLogger";
import type { AchievementState, MythicClaimMeta, XPMessageType } from "../types/level";

function isAchievementState(value: unknown): value is AchievementState {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj.id !== "string") return false;
  if (typeof obj.unlocked !== "boolean") return false;

  if (obj.progress !== undefined) {
    if (typeof obj.progress !== "object" || obj.progress === null) return false;
    const p = obj.progress as Record<string, unknown>;
    if (typeof p.current !== "number" || typeof p.target !== "number") return false;
  }

  return true;
}

/**
 * Manages XP calculations and level progression logic
 * @param userId - Current user identifier
 * @param addXPMessage - Callback for XP notification display
 * @returns XP state and calculation methods
 */
export const useSessionXP = (
  userId?: string,
  addXPMessage?: (text: string, value: number, type: XPMessageType) => void,
  bootstrapProgress?: { level?: unknown; xp?: unknown; achievements?: unknown; nextLevelXP?: unknown }
) => {
  // Level state management with reducer
  const [state, dispatch] = useReducer(levelReducer, {
    level: 1,
    userXP: 0,
    achievements: [],
    nextLevelXP: calculateNextLevelXP(1),
  });

  const hydratedRef = useRef(false);
  const lastUserIdRef = useRef<string | undefined>(undefined);

  const applyBootstrapProgress = useCallback(
    (id: string, bootstrapProgress?: { level?: unknown; xp?: unknown; achievements?: unknown; nextLevelXP?: unknown }) => {
      if (!bootstrapProgress) return false;

      const level = Number(bootstrapProgress.level);
      const xp = Number(bootstrapProgress.xp);
      const achievements: AchievementState[] = Array.isArray(bootstrapProgress.achievements)
        ? (bootstrapProgress.achievements as unknown[]).filter(isAchievementState)
        : [];

      if (!Number.isFinite(level) || !Number.isFinite(xp)) return false;

      dispatch({
        type: "SET_PROGRESS",
        level: level > 0 ? level : 1,
        userXP: xp >= 0 ? xp : 0,
        achievements,
      });

      // Do not persist level/xp in localStorage (anti-cheat).
      // Bootstrap is already server-derived and will be refreshed by the API hydration.
      return true;
    },
    []
  );

  useEffect(() => {
    if (lastUserIdRef.current !== userId) {
      // Important: avoid showing previous user's level while we re-hydrate.
      dispatch({ type: "RESET_PROGRESS" });
      hydratedRef.current = false;
      lastUserIdRef.current = userId;
    }

    if (!userId) return;

    // If bootstrap provided authoritative progress, apply it immediately.
    if (!hydratedRef.current && bootstrapProgress) {
      applyBootstrapProgress(userId, bootstrapProgress);
    }

    if (hydratedRef.current) return;

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

    const abortController = new AbortController();
    const hydrate = async () => {
      try {
        const res = await fetch("/api/profile/progress", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: abortController.signal,
        });

        if (!res.ok) return;
        const data = await res.json();
        const progress = data?.progress;
        if (!progress) return;

        dispatch({
          type: "SET_PROGRESS",
          level: Number(progress.level) || 1,
          userXP: Number(progress.xp) || 0,
          achievements: Array.isArray(progress.achievements) ? progress.achievements : [],
        });
      } catch (error) {
        // Non-fatal; keep defaults.
        const err = error instanceof Error ? error : new Error(String(error));
        logger.xp.warn("Failed to hydrate level state", { userId, error: err.message });
      } finally {
        hydratedRef.current = true;
      }
    };

    const idleHandle = scheduleIdle(() => {
      hydrate();
    });

    return () => {
      idleHandle.cancel();
      abortController.abort();
    };
  }, [userId, bootstrapProgress, applyBootstrapProgress]);

  const addXP = useCallback(
    async (amount: number, bonusMeta?: MythicClaimMeta) => {
      if (amount <= 0 || !userId) return;

      // Optimistic UI update
      dispatch({ type: "ADD_XP", amount });

      // Persist to DB (best-effort, then reconcile)
      try {
        const res = await fetch("/api/profile/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            xpDelta: amount,
            ...(bonusMeta ? { bonusMeta } : {}),
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const progress = data?.progress;
        if (progress && typeof progress.level === "number" && typeof progress.xp === "number") {
          dispatch({
            type: "SET_PROGRESS",
            level: progress.level,
            userXP: progress.xp,
            achievements: state.achievements,
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.xp.warn("Failed to persist XP to server", { userId, amount, error: err.message });
      }
    },
    [userId, state.achievements]
  );

  // Memoized XP calculation with side effects — forwards optional onMythicClaim callback
  const enhancedCalculateXP = useCallback(
    (
      session: Parameters<typeof calculateSessionXP>[0],
      onMythicClaim?: (meta: MythicClaimMeta) => void
    ) => calculateSessionXP(session, state, userId, addXPMessage, dispatch, onMythicClaim),
    [state, userId, addXPMessage]
  );

  return { state, calculateSessionXP: enhancedCalculateXP, addXP };
};