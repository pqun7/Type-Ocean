import { authFetch } from "@/features/auth/utils/authFetch";
import * as Sentry from "@sentry/nextjs";

export type SessionStats = {
  dailyAvgWpm: number;
  dailyAvgAcc: number;
  sessionsCount: number;
};

export const sessionStatsService = {
  async recordSession(
    userId: string,
    wpm: number,
    accuracy: number
  ): Promise<SessionStats> {
    try {
      const response = await authFetch<SessionStats>(
        "/api/session-stats/v1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wpm, accuracy }),
        },
        userId
      );

      return response;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { service: "session-stats" },
        user: { id: userId },
      });
      throw new Error("Failed to record session stats");
    }
  },
};