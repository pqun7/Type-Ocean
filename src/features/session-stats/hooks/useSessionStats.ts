import { useState, useEffect, useCallback } from 'react';
import { useUserSession } from '@/features/auth/hooks/useUserSession';

interface SessionData {
  wpm: number;
  accuracy: number;
  textLength: number;
  timeSpent: number;
  errors: number;
  timestamp: number;
}

interface DailyStats {
  totalSessions: number;
  averageWpm: number;
  averageAccuracy: number;
  bestWpm: number;
  bestAccuracy: number;
  totalCharacters: number;
  totalTime: number;
  lastUpdated: string;
}

interface WeeklyStats {
  [date: string]: DailyStats;
}

export const useSessionStats = () => {
  const { userId } = useUserSession();
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordSession = useCallback(async (sessionData: Omit<SessionData, 'timestamp'>) => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/session-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          ...sessionData,
          timestamp: Date.now(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to record session');
      }

      const result = await response.json();
      
      // Update local stats if returned
      if (result.stats) {
        setDailyStats(result.stats);
      }

      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record session');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchDailyStats = useCallback(async (date?: string) => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (date) params.append('date', date);

      const response = await fetch(`/api/session-stats?${params}`, {
        headers: {
          'x-user-id': userId,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch daily stats');
      }

      const stats = await response.json();
      setDailyStats(stats);
      return stats;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchWeeklyStats = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/session-stats/weekly', {
        headers: {
          'x-user-id': userId,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch weekly stats');
      }

      const stats = await response.json();
      setWeeklyStats(stats);
      return stats;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch weekly stats');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      fetchDailyStats();
    }
  }, [userId, fetchDailyStats]);

  return {
    dailyStats,
    weeklyStats,
    loading,
    error,
    recordSession,
    fetchDailyStats,
    fetchWeeklyStats,
    refetch: fetchDailyStats,
  };
};