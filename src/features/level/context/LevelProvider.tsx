"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LevelContext } from "./LevelContext";
import type { DailyChallenge, SessionData } from "@/features/level/types/level";

// Module-level no-op fallbacks (stable references to satisfy hook deps)
const noopAddXP = (async () => {}) as (amount: number) => Promise<void>;
const noopCalculate = (() => 0) as (session: SessionData) => number;
const noopHandle = (async () => ({ completed: false, xp: 0 })) as (
  session: SessionData
) => Promise<{ completed: boolean; xp: number }>;
import { useDailyChallengeLoader } from "@/features/level/hooks/useDailyChallenge";
import { useXPMessages } from "@/features/level/hooks/useXPMessages";
import { useSessionXP } from "@/features/level/hooks/useSessionXP";
import { useChallengeHandler } from "@/features/level/hooks/useChallengeHandler";
import { useSessionStats } from "@/features/level/hooks/useSessionStats";

type BootstrapPayload = {
  valid: boolean;
  reason?: string;
  userId?: string;
  progress?: {
    level?: unknown;
    xp?: unknown;
    nextLevelXP?: unknown;
    achievements?: unknown;
  };
  dailyChallenge?: DailyChallenge;
  dailyChallengeStreak?: number;
};

type AuthPayload = {
  valid: boolean;
  reason?: string;
  userId?: string;
};

export const LevelProvider = ({
  children,
  initialUserId,
}: {
  children: ReactNode;
  initialUserId?: string | null;
}) => {
  const [auth, setAuth] = useState<AuthPayload | null>(() =>
    initialUserId ? { valid: true, userId: initialUserId } : null
  );
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(() => !initialUserId);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  const userId = auth?.valid ? auth.userId : undefined;

  const loadAuth = useCallback(async (abortSignal?: AbortSignal) => {
    setIsAuthLoading(true);
    try {
      const res = await fetch("/api/home/auth", {
        method: "GET",
        credentials: "include",
        signal: abortSignal,
      });

      if (!res.ok) {
        setAuth({ valid: false, reason: `http_${res.status}` });
        return { valid: false } as AuthPayload;
      }

      const data = (await res.json()) as AuthPayload;
      setAuth(data);
      return data;
    } catch {
      const data: AuthPayload = { valid: false, reason: "network_error" };
      setAuth(data);
      return data;
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  const loadBootstrap = useCallback(async (id: string, abortSignal?: AbortSignal) => {
    setIsLoadingSession(true);
    try {
      const res = await fetch("/api/home/bootstrap", {
        method: "GET",
        credentials: "include",
        signal: abortSignal,
      });

      if (!res.ok) {
        setBootstrap({ valid: false, reason: `http_${res.status}` });
        return;
      }

      const data = (await res.json()) as BootstrapPayload;

      // Safety: if auth changed mid-flight, ignore mismatched bootstrap.
      if (data?.valid && data.userId && data.userId !== id) return;

      setBootstrap(data);
    } catch {
      setBootstrap({ valid: false, reason: "network_error" });
    } finally {
      setIsLoadingSession(false);
    }
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    (async () => {
      // SSR-seeded auth: skip /api/home/auth on first paint.
      if (initialUserId) {
        setAuth({ valid: true, userId: initialUserId });
        setIsAuthLoading(false);
        await loadBootstrap(initialUserId, abortController.signal);
        return;
      }

      const authData = await loadAuth(abortController.signal);
      if (authData?.valid && authData.userId) {
        await loadBootstrap(authData.userId, abortController.signal);
        return;
      }

      // Not logged in: stop bootstrapping state so UI can show login.
      setBootstrap(null);
      setIsLoadingSession(false);
    })();
    return () => abortController.abort();
  }, [initialUserId, loadAuth, loadBootstrap]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onAuthChanged = () => {
      const abortController = new AbortController();
      void (async () => {
        const authData = await loadAuth(abortController.signal);
        if (authData?.valid && authData.userId) {
          await loadBootstrap(authData.userId, abortController.signal);
        } else {
          setBootstrap(null);
          setIsLoadingSession(false);
        }
      })();
    };

    window.addEventListener("auth:changed", onAuthChanged);
    return () => window.removeEventListener("auth:changed", onAuthChanged);
  }, [loadAuth, loadBootstrap]);

  const bootstrapProgress = bootstrap?.valid ? bootstrap.progress : undefined;
  const bootstrapChallenge = bootstrap?.valid ? bootstrap.dailyChallenge ?? null : null;
  const dailyChallengeStreak = bootstrap?.valid ? (bootstrap.dailyChallengeStreak ?? 0) : 0;

  const { xpMessages, addXPMessage, clearAllMessages } = useXPMessages();
  // Load supporting data/hooks (these hooks handle missing userId internally)
  const { dailyChallenge } = useDailyChallengeLoader(userId, bootstrapChallenge, isLoadingSession);
  const { state, calculateSessionXP, addXP } = useSessionXP(userId, addXPMessage, bootstrapProgress);
  const { handleDailyChallenge, optimisticChallenge } = useChallengeHandler(userId, dailyChallenge);
  const { recordSessionStats } = useSessionStats(userId);

  const effectiveDailyChallenge = optimisticChallenge ?? dailyChallenge ?? null;

  const contextValue = useMemo(() => {
    return {
      // state values (provide defaults if undefined)
      level: state?.level ?? 1,
      userXP: state?.userXP ?? 0,
      nextLevelXP: state?.nextLevelXP ?? 0,
      achievements: state?.achievements ?? [],

      // runtime values
      userId: userId ?? null,
      dailyChallenge: effectiveDailyChallenge,
      dailyChallengeStreak,

      // functions (use real ones when available, otherwise no-ops)
      addXP: addXP ?? noopAddXP,
      calculateSessionXP: calculateSessionXP ?? noopCalculate,
      handleDailyChallenge: handleDailyChallenge ?? noopHandle,

      // XP messages
      xpMessages,
      addXPMessage,
      clearXPMessages: clearAllMessages,

      // stats
      recordSessionStats,

      // loading
      isAuthLoading,
      isLoadingSession,
    };
  }, [
    state,
    userId,
    effectiveDailyChallenge,
    dailyChallengeStreak,
    xpMessages,
    addXPMessage,
    clearAllMessages,
    addXP,
    calculateSessionXP,
    handleDailyChallenge,
    recordSessionStats,
    isAuthLoading,
    isLoadingSession,
  ]);

  return (
    <LevelContext.Provider value={contextValue}>
      {children}
    </LevelContext.Provider>
  );
};
