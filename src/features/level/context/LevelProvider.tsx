"use client";
import { useMemo } from "react";
import { LevelContext } from "./LevelContext";
import type { SessionData } from "@/features/level/types/level";

// Module-level no-op fallbacks (stable references to satisfy hook deps)
const noopAddXP = (() => {}) as (amount: number) => void;
const noopCalculate = (() => 0) as (session: SessionData) => number;
const noopHandle = (async () => ({ completed: false, xp: 0 })) as (
  session: SessionData
) => Promise<{ completed: boolean; xp: number }>;
import { useUserSession } from "@/features/auth/hooks/useUserSession";
import { useDailyChallengeLoader } from "@/features/level/hooks/useDailyChallenge";
import { useXPMessages } from "@/features/level/hooks/useXPMessages";
import { useSessionXP } from "@/features/level/hooks/useSessionXP";
import { useChallengeHandler } from "@/features/level/hooks/useChallengeHandler";
import { useSessionStats } from "@/features/level/hooks/useSessionStats";

export const LevelProvider = ({ children }: { children: React.ReactNode }) => {
  const { userId, isLoading } = useUserSession();

  // Load supporting data/hooks (these hooks handle missing userId internally)
  const { dailyChallenge } = useDailyChallengeLoader(userId);
  const { xpMessages, addXPMessage, clearAllMessages } = useXPMessages();
  const { state, calculateSessionXP, addXP } = useSessionXP(userId, addXPMessage);
  const { handleDailyChallenge } = useChallengeHandler(userId, dailyChallenge);
  const { recordSessionStats } = useSessionStats();

  const contextValue = useMemo(() => {
    return {
      // state values (provide defaults if undefined)
      level: state?.level ?? 1,
      userXP: state?.userXP ?? 0,
      nextLevelXP: state?.nextLevelXP ?? 0,
      achievements: state?.achievements ?? [],

      // runtime values
      userId: userId ?? null,
      dailyChallenge: dailyChallenge ?? null,

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
      isLoadingSession: !!isLoading,
    };
  }, [
    state,
    userId,
    dailyChallenge,
    xpMessages,
    addXPMessage,
    clearAllMessages,
    addXP,
    calculateSessionXP,
    handleDailyChallenge,
    recordSessionStats,
    isLoading,
  ]);

  return (
    <LevelContext.Provider value={contextValue}>
      {children}
    </LevelContext.Provider>
  );
};
