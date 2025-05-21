import { useMemo } from "react";
import { LevelContext } from "./LevelContext";
import { useUserSession } from "@/features/level/hooks/useUserSession";
import { useDailyChallengeLoader } from "@/features/level/hooks/useDailyChallenge";
import { useXPMessages } from "@/features/level/hooks/useXPMessages";
import { useSessionXP } from "@/features/level/hooks/useSessionXP";
import { useChallengeHandler } from "@/features/level/hooks/useChallengeHandler";

export const LevelProvider = ({ children }: { children: React.ReactNode }) => {
  const { userId } = useUserSession();
  const { dailyChallenge } = useDailyChallengeLoader(userId);
  const { xpMessages, addXPMessage, clearAllMessages } = useXPMessages();
  const { state, calculateSessionXP } = useSessionXP(userId, addXPMessage);
  const { handleDailyChallenge } = useChallengeHandler(userId, dailyChallenge);

  const contextValue = useMemo(
    () => ({
      ...state,
      dailyChallenge,
      xpMessages,
      addXPMessage,
      calculateSessionXP,
      handleDailyChallenge,
      clearXPMessages: clearAllMessages,
    }),
    [state, dailyChallenge, xpMessages]
  );

  return (
    <LevelContext.Provider value={contextValue}>
      {children}
    </LevelContext.Provider>
  );
};