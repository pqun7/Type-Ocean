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
} from "@/types/level";
import { levelReducer } from "./reducers/levelReducer";
import {
  calculateNextLevelXP,
  getChallengeXP,
  generateDailyChallenge,
} from "./utils/levelUtils";
import {
  ACHIEVEMENTS,
  DAILY_CHALLENGE_BASE_XP,
  BONUSES,
} from "./constants/level";

export const LevelContext = createContext<LevelContextType | null>(null);

export const LevelProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(levelReducer, {
    level: 1,
    userXP: 0,
    achievements: [],
    nextLevelXP: calculateNextLevelXP(1),
  });
  const [xpMessages, setXPMessages] = useState<XPMessage[]>([]);
  const [streak, setStreak] = useState(0);
  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(null);

  useEffect(() => {
    const loadDailyChallenge = async () => {
      const today = new Date().toISOString().split('T')[0];
      const storedChallenge = localStorage.getItem('dailyChallenge');
      let challenge: DailyChallenge | null = null;

      // Check existing challenge
      if (storedChallenge) {
        const parsed = JSON.parse(storedChallenge);
        if (parsed.date === today) challenge = parsed;
      }

      // Generate new if none exists
      if (!challenge) {
        challenge = await generateDailyChallenge(state.level);
        localStorage.setItem('dailyChallenge', JSON.stringify(challenge));
      }

      setDailyChallenge(challenge);
    };

    loadDailyChallenge();
  }, [state.level]);

  const addXPMessage = useCallback(
    (text: string, value: number, type: XPMessageType) => {
      // Only add message if value is positive
      if (value > 0) {
        const message: XPMessage = {
          id: uuidv4(),
          text,
          value,
          type,
        };

        setXPMessages((prev) => [...prev, message]);

        setTimeout(
          () => {
            setXPMessages((prev) =>
              prev.filter((msg) => msg.id !== message.id)
            );
          },
          type === "level-up" ? 5000 : 3000
        );
      }
    },
    []
  );

  const calculateDailyAverage = useCallback(
    (newWpm: number, newAcc: number) => {
      const today = new Date().toISOString().split("T")[0];
      const storedData = localStorage.getItem("dailyStats");
      const prevData = storedData
        ? JSON.parse(storedData)
        : {
            n: 0,
            avgWpm: 0,
            avgAcc: 0,
            date: today,
          };

      // إذا كان يوم جديد: تحديث المتوسطات مع الاحتفاظ بقيمة n
      if (prevData.date !== today) {
        const newAvgWpm = newWpm; // ابدأ بمتوسط اليوم الجديد
        const newAvgAcc = newAcc;

        const newData = {
          n: prevData.n + 1, // زيادة n التراكمية
          avgWpm: newAvgWpm,
          avgAcc: newAvgAcc,
          date: today,
        };

        localStorage.setItem("dailyStats", JSON.stringify(newData));

        return {
          dailyAvgWpm: newAvgWpm,
          dailyAvgAcc: newAvgAcc,
          sessionsCount: newData.n,
        };
      }

      // إذا كان نفس اليوم: تحديث المتوسطات
      const newN = prevData.n + 1;
      const newAvgWpm = (prevData.avgWpm * prevData.n + newWpm) / newN;
      const newAvgAcc = (prevData.avgAcc * prevData.n + newAcc) / newN;

      const updatedData = {
        n: newN,
        avgWpm: newAvgWpm,
        avgAcc: newAvgAcc,
        date: today,
      };

      localStorage.setItem("dailyStats", JSON.stringify(updatedData));

      return {
        dailyAvgWpm: newAvgWpm,
        dailyAvgAcc: newAvgAcc,
        sessionsCount: newN,
      };
    },
    []
  );

  const handleDailyChallenge = useCallback(
    (session: SessionData) => {
      const today = new Date().toISOString().split('T')[0];
      const stored = localStorage.getItem('dailyChallenge');
      if (!stored) return { completed: false, xp: 0 };
  
      const challenge: DailyChallenge = JSON.parse(stored);
      if (challenge.date !== today || challenge.status === 1) {
        return { completed: false, xp: 0 };
      }
  
      const updated: DailyChallenge = { ...challenge };
      let completed = false;
  
      switch (updated.type) {
        case 'marathon':
          updated.data = updated.data || {};
          updated.data.charactersTyped = (updated.data.charactersTyped || 0) + session.textLength;
          if (updated.data.charactersTyped >= (updated.target as number)) {
            updated.status = 1;
            completed = true;
          }
          break;
        
        case 'timeAttack':
          updated.data = updated.data || {};
          updated.data.timeSpent = (updated.data.timeSpent || 0) + session.timeSpent;
          if (updated.data.timeSpent >= (updated.target as number)) {
            updated.status = 1;
            completed = true;
          }
          break;
        
        case 'speedCombo':
          const target = updated.target as { wpm: number; accuracy: number };
          if (session.wpm >= target.wpm && session.accuracy >= target.accuracy) {
            updated.status = 1;
            completed = true;
          }
          break;
      }
  
      if (completed) {
        localStorage.setItem('dailyChallenge', JSON.stringify(updated));
        setDailyChallenge(updated);
        return { completed: true, xp: updated.xp };
      } else {
        localStorage.setItem('dailyChallenge', JSON.stringify(updated));
        setDailyChallenge(updated);
        return { completed: false, xp: 0 };
      }
    },
    [state.level, addXPMessage]
  );

  const calculateSessionXP = useCallback(
    (session: SessionData) => {
      const messages: XPMessage[] = [];
      let totalXP = 0;

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
      messages.push({
        id: uuidv4(),
        text: `Base XP`,
        value: baseXP,
        type: "base",
      });

      const streakBonus = Math.log1p(streak) * 30; // زيادة من 15
      const levelModifier = 1 + state.level / 40; // زيادة التأثير من 80 إلى 40
      const performanceXP = Math.round(
        baseXP * ((streakBonus / 100) * levelModifier)
      );
      totalXP += performanceXP;
      messages.push({
        id: uuidv4(),
        text: `Performance Bonus`,
        value: performanceXP,
        type: "bonus",
      });

      // if (handleDailyChallenge(messages, session, totalXP)) {
      //   // Ensure proper handling of daily challenge completion
      //   addXPMessage(
      //     "Daily Challenge Completed",
      //     DAILY_CHALLENGE_BASE_XP,
      //     "daily-challenge"
      //   );
      // }

      ACHIEVEMENTS.forEach((achievement) => {
        const existing = state.achievements.find(
          (a) => a.id === achievement.id
        );
        if (existing?.unlocked) return;

        const result = achievement.condition(session, existing?.progress);

        if (result.achieved) {
          messages.push({
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
          messages.push({
            id: uuidv4(),
            text: `${bonus.name}`,
            value: calculatedReward,
            type: "bonus",
          });
        }
      });

      messages.forEach((msg) => {
        if (msg.value > 0) {
          addXPMessage(msg.text, msg.value, msg.type);
        }
      });

      return totalXP;
    },
    [state.level, streak, state.achievements, addXPMessage]
  );
  
  const contextValue = useMemo(
    () => ({
      level: state.level,
      userXP: state.userXP,
      nextLevelXP: state.nextLevelXP,
      streak,
      dailyChallenge,
      achievements: state.achievements,
      addXP: (amount: number) => dispatch({ type: "ADD_XP", amount }),
      calculateSessionXP,
      xpMessages,
      addXPMessage,
      calculateDailyAverage,
      handleDailyChallenge,
    }),
    [
      state,
      streak,
      xpMessages,
      calculateSessionXP,
      dailyChallenge,
    ]
  );

  return (
    <LevelContext.Provider value={contextValue}>
      {children}
    </LevelContext.Provider>
  );
};
