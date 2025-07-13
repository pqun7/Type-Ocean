"use client";
import { useMemo } from "react";
import { LevelContext } from "./LevelContext";
import { useUserSession } from "@/features/auth/hooks/useUserSession";
import { useDailyChallengeLoader } from "@/features/level/hooks/useDailyChallenge";
import { useXPMessages } from "@/features/level/hooks/useXPMessages";
import { useSessionXP } from "@/features/level/hooks/useSessionXP";
import { useChallengeHandler } from "@/features/level/hooks/useChallengeHandler";
import { useSessionStats } from "@/features/level/hooks/useSessionStats";

export const LevelProvider = ({ children }: { children: React.ReactNode }) => {
  const { userId, isLoading } = useUserSession();

  // Ensure we're running in the browser before executing any hooks
  if (typeof window === "undefined") {
    return null;
  }

  const { dailyChallenge } = useDailyChallengeLoader(userId);
  const { xpMessages, addXPMessage, clearAllMessages } = useXPMessages();
  const { state, calculateSessionXP, addXP } = useSessionXP(userId, addXPMessage);
  const { handleDailyChallenge } = useChallengeHandler(userId, dailyChallenge);
  const { recordSessionStats } = useSessionStats();

  const contextValue = useMemo(() => {
    if (!userId) return null;
    return {
      ...state,
      userId,
      dailyChallenge,
      xpMessages,
      addXPMessage,
      calculateSessionXP,
      handleDailyChallenge,
      clearXPMessages: clearAllMessages,
      recordSessionStats,
      addXP,
      isLoadingSession: isLoading,
    };
  }, [state, dailyChallenge, xpMessages, userId, isLoading]);

  if (!contextValue) {
    return null; // Or render a loading spinner
  }

  return (
    <LevelContext.Provider value={contextValue}>
      {children}
    </LevelContext.Provider>
  );
};
