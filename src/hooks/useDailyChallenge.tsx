'use client';

import { useEffect, useState } from 'react';
import { DailyChallenge } from '@/types/level';
import { generateDailyChallenge } from '@/contexts/utils/levelUtils';

export const useDailyChallenge = (level: number) => {
  const [challenge, setChallenge] = useState<DailyChallenge>({
    type: "wpm",
    target: 80,
    xp: 500,
    date: '', // Don't forget to include `date` if your type expects it!
  });

  useEffect(() => {
    const updateChallenge = async () => {
      const today = new Date().toISOString().split('T')[0];
      const stored = localStorage.getItem('dailyChallenge');

      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.date === today) {
          setChallenge(parsed);
          return;
        }
      }

      const newChallenge = await generateDailyChallenge(level);
      localStorage.setItem('dailyChallenge', JSON.stringify(newChallenge));
      setChallenge(newChallenge);
    };

    updateChallenge();

    const interval = setInterval(updateChallenge, 60000);
    return () => clearInterval(interval);
  }, [level]);

  return challenge;
};
