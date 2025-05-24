"use client";

import {
  createContext,
  useReducer,
  useCallback,
  useMemo,
  useState,
  useEffect,
} from "react";
import { v4 as uuidv4 } from "uuid";
import {
  LevelContextType,
  XPMessage,
  SessionData,
  XPMessageType,
  DailyChallenge,
} from "@/features/level/types/level";
import { levelReducer } from "@/features/level/reducers/levelReducer";
import { generateDailyChallenge, calculateChallengeStatus } from "@/features/level/utils/challengeHelpers";
import {
  calculateNextLevelXP,
  getChallengeXP,
} from "@/features/level/utils/xpMath";

import { ACHIEVEMENTS, BONUSES } from "@/features/level/constants/level";
import { authFetch } from "@/features/auth/utils/authFetch";
import { logger } from "@/log/clientLogger";
import { XP_MESSAGE_TIMEOUT } from "@/features/level/constants/level";
import { getSession } from "next-auth/react";

// Make sure you do NOT import anything from "@/lib/redis" or any server-only code here.
const CACHE_KEYS = {
  DAILY_CHALLENGE: (userId: string) => `dailyChallenge:${userId}`,
  SESSION_STATS: (userId: string) => `sessionStats:${userId}`,
};

export const LevelContext = createContext<LevelContextType | null>(null);

export const LevelProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(levelReducer, {
    level: 1,
    userXP: 0,
    achievements: [],
    nextLevelXP: calculateNextLevelXP(1),
  });
  const [xpMessages, setXPMessages] = useState<XPMessage[]>([]);
  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(
    null
  );
  const [userId, setUserId] = useState<string | undefined>(undefined); // حالة المستخدم

  // User session management
  useEffect(() => {
    const fetchSession = async () => {
      const session = await getSession();
      if (session?.user?.id) {
        setUserId(session.user.id);
      }
    };
    fetchSession();
  }, []);

  // Daily challenge loader with abort controller
  useEffect(() => {
    const abortController = new AbortController();
    const requestId = uuidv4();

    const loadChallenge = async (): Promise<void> => {
      if (!userId) {
        logger.challenge.warn("Aborting challenge load - missing user ID", {
          requestId,
        });
        return;
      }

      try {
        logger.challenge.info("Loading daily challenge", {
          requestId,
          userId,
          currentLevel: state.level,
        });

        const response = await authFetch(
          `/api/daily-challenge`,
          {
            signal: abortController.signal,
            headers: { "X-Request-ID": requestId },
          },
          userId
        );

        const challenge: DailyChallenge = await (response as Response).json();
        setDailyChallenge(challenge);
        logger.challenge.info("Daily challenge loaded", {
          requestId,
          challengeId: challenge.id,
          difficulty: challenge.difficulty,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          logger.challenge.debug("Challenge load aborted", { requestId });
          return;
        }

        logger.challenge.error(
          "Failed to load daily challenge",
          error instanceof Error ? error : undefined,
          {
            requestId,
            fallbackUsed: true,
          }
        );

        const fallbackChallenge = await generateDailyChallenge(
          userId,
          state.level
        );
        setDailyChallenge(fallbackChallenge);
      }
    };

    loadChallenge();

    return () => {
      abortController.abort();
      logger.challenge.debug("Cleanup challenge loader", { requestId });
    };
  }, [userId, state.level]);

  // حساب المتوسطات اليومية مع Redis
  const fallbackAverages = { dailyAvgWpm: 0, dailyAvgAcc: 0, sessionsCount: 0 };

  const calculateSessionAverage = useCallback(
    async (newWpm: number, newAcc: number) => {
      if (!userId) return fallbackAverages;

      try {
        const response = (await authFetch(
          "/api/session-stats",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Performance-Metrics": "v2",
            },
            body: JSON.stringify({
              wpm: newWpm,
              accuracy: newAcc,
              timestamp: Date.now(),
            }),
          },
          userId
        )) as Response;

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.dailyAvgWpm || !data.dailyAvgAcc || !data.sessionsCount) {
          throw new Error("Invalid session stats response");
        }

        return data;
      } catch (error) {
        logger.session.error(
          "Session average calculation failed",
          error instanceof Error ? error : undefined
        );
        return fallbackAverages;
      }
    },
    [userId]
  );

  const handleDailyChallenge = useCallback(
    async (session: SessionData) => {
      if (!dailyChallenge || !userId) return { completed: false, xp: 0 };

      // حفظ الحالة الحالية للتراجع
      const prevChallenge = dailyChallenge;

      // تحديث محلي فوري
      const tempChallenge = {
        ...dailyChallenge,
        progress: session,
        status: calculateChallengeStatus(dailyChallenge, session) as 0 | 1,
      };
      setDailyChallenge(tempChallenge);

      try {
        const response = await authFetch(
          `/api/daily-challenge/${dailyChallenge.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ progress: session }),
          },
          userId
        );

        if (!(response instanceof Response)) {
          throw new Error("Unexpected response type");
        }

        const result = await response.json();
        setDailyChallenge(result.updatedChallenge);

        return result;
      } catch (error) {
        // التراجع عند الخطأ
        setDailyChallenge(prevChallenge);
        logger.challenge.error(
          "Challenge update failed",
          error instanceof Error ? error : undefined
        );
        throw error; // لإعادة التحميل أو المعالجة
      }
    },
    [dailyChallenge, userId]
  );

  // إدارة رسائل XP مع تحسين الأداء
  const addXPMessage = useCallback(
    (text: string, value: number, type: XPMessageType) => {
      if (value <= 0) return;

      const message: XPMessage = {
        id: uuidv4(),
        text,
        value,
        type,
      };

      setXPMessages((prev) => [...prev, message]);

      const timeout = setTimeout(
        () => setXPMessages((prev) => prev.filter((m) => m.id !== message.id)),
        XP_MESSAGE_TIMEOUT[type as keyof typeof XP_MESSAGE_TIMEOUT] ||
          XP_MESSAGE_TIMEOUT.BASE
      );
      return () => clearTimeout(timeout);
    },
    []
  );

  const calculateSessionXP = useCallback(
    (session: SessionData) => {
      if (!userId) return 0;

      const calculationStart = performance.now();
      const sessionId = uuidv4();

      try {
        logger.perf.debug("Starting XP calculation", { sessionId, userId });

        let totalXP = 0;
        const xpEvents: XPMessage[] = [];
        let addedBaseXP: number;

        if (state.level <= 5) {
          addedBaseXP = 100; // زيادة من 50
        } else if (state.level <= 10) {
          addedBaseXP = 150; // زيادة من 75
        } else if (state.level <= 50) {
          addedBaseXP = 200; // زيادة من 100
        } else {
          addedBaseXP = 300; // زيادة من 150
        }

        // 1. حساب الحد الأقصى لـ XP حسب المستوى
        const maxBaseXP = Math.min(addedBaseXP + state.level * 10, 1000); // زيادة من 700

        // 2. توزيع النسب حسب الأولوية
        const accuracyWeight = 0.4; // 60%
        const textWeight = 0.3; // 30%
        const speedWeight = 0.3; // 10%

        // 3. حساب كل مكون مع مراعاة الدقة
        const accuracyEffect = Math.pow(session.accuracy / 100, 1.8);

        // XP الدقة (العامل الأساسي)
        const accuracyXP = Math.round(
          maxBaseXP * accuracyWeight * accuracyEffect
        );

        const textXP = Math.round(
          Math.min(
            Math.log(session.textLength + 1) * 70, // زيادة من 35
            maxBaseXP * textWeight
          ) * accuracyEffect
        );

        // XP السرعة
        const speedXP = Math.round(
          Math.min(session.wpm * 1.4, maxBaseXP * speedWeight) * // زيادة من 0.7
            Math.pow(accuracyEffect, 2)
        );

        // 4. الجمع النهائي
        let baseXP = accuracyXP + textXP + speedXP;

        // 5. تطبيق الحدود القصوى
        baseXP = Math.min(baseXP, maxBaseXP);
        totalXP += baseXP;
        xpEvents.push({
          id: uuidv4(),
          text: `Base XP`,
          value: baseXP,
          type: "base",
        });

        ACHIEVEMENTS.forEach((achievement) => {
          const existing = state.achievements.find(
            (a) => a.id === achievement.id
          );
          if (existing?.unlocked) return;

          const result = achievement.condition(session, existing?.progress);

          if (result.achieved) {
            xpEvents.push({
              id: uuidv4(),
              text: `${achievement.name}`,
              value: achievement.xpReward,
              type: "achievement",
            });
            totalXP += achievement.xpReward;
            dispatch({
              type: "UNLOCK_ACHIEVEMENT",
              achievement: {
                ...achievement,
                unlocked: true,
                progress: result.current
                  ? {
                      current: result.current,
                      target: achievement.progress?.target || result.current,
                    }
                  : undefined,
              },
            });
          } else if (result.current !== undefined) {
            dispatch({
              type: "UPDATE_ACHIEVEMENT",
              achievement: {
                ...achievement,
                progress: {
                  current: result.current,
                  target: achievement.progress?.target || result.current,
                },
              },
            });
          }
        });

        BONUSES.forEach((bonus) => {
          if (bonus.condition(session)) {
            const calculatedReward = getChallengeXP(state.level);

            totalXP += calculatedReward;
            xpEvents.push({
              id: uuidv4(),
              text: `${bonus.name}`,
              value: calculatedReward,
              type: "bonus",
            });
          }
        });

        xpEvents.forEach((msg) => {
          if (msg.value > 0) {
            addXPMessage(msg.text, msg.value, msg.type);
          }
        });

        if (totalXP > 500) {
          console.warn(
            JSON.stringify({
              type: "HIGH_XP_EVENT",
              userId,
              totalXP,
              sessionDetails: {
                wpm: session.wpm,
                accuracy: session.accuracy,
                textLength: session.textLength,
              },
              timestamp: new Date().toISOString(),
            })
          );
        }

        logger.xp.info("Session XP calculated", {
          sessionId,
          totalXP,
          duration: `${performance.now() - calculationStart}ms`,
        });

        return totalXP;
      } catch (error) {
        logger.xp.error(
          "XP calculation failed",
          error instanceof Error ? error : undefined,
          {
            sessionId,
            userId,
            sessionDetails: {
              wpm: session.wpm,
              accuracy: session.accuracy,
              textLength: session.textLength,
            },
          }
        );
        return 0;
      }
    },
    [state.level, state.achievements, addXPMessage]
  );
  const contextValue = useMemo(
    () => ({
      level: state.level,
      userXP: state.userXP,
      nextLevelXP: state.nextLevelXP,

      dailyChallenge,
      achievements: state.achievements,
      addXP: (amount: number) => dispatch({ type: "ADD_XP", amount }),
      calculateSessionXP,
      xpMessages,
      addXPMessage,
      calculateSessionAverage,
      handleDailyChallenge,
    }),
    [state, xpMessages, dailyChallenge]
  );

  return (
    <LevelContext.Provider value={contextValue}>
      {children}
    </LevelContext.Provider>
  );
};
