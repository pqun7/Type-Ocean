// src/features/level/services/sessionStatsService.ts
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
      // Validate input parameters
      if (!userId || typeof userId !== "string") {
        throw new Error("Invalid user ID provided");
      }

      if (typeof wpm !== "number" || typeof accuracy !== "number") {
        throw new Error("Invalid stats values: WPM and accuracy must be numbers");
      }

      if (wpm < 0 || accuracy < 0 || accuracy > 100) {
        throw new Error(
          "Invalid stats values: WPM cannot be negative and accuracy must be between 0-100"
        );
      }

      const response = await authFetch<SessionStats>("/api/session-stats/v1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wpm, accuracy }),
        userId,
        timeout: 10000, // Increase timeout for better reliability
      });

      return response;
    } catch (error) {
      // Log the error with more context
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      Sentry.captureException(error, {
        tags: {
          service: "session-stats",
          operation: "recordSession",
        },
        user: { id: userId },
        extra: {
          wpm,
          accuracy,
          errorMessage,
        },
      });

      // Provide more specific error messages to help with debugging
      if (errorMessage.includes("timeout")) {
        throw new Error(
          "Session stats recording timed out. Please check your connection and try again."
        );
      } else if (errorMessage.includes("Authentication failed")) {
        throw new Error("Authentication failed. Please sign in again.");
      } else if (errorMessage.includes("Too many requests")) {
        throw new Error(
          "Too many requests. Please wait a moment before trying again."
        );
      } else if (errorMessage.includes("Server error")) {
        throw new Error(
          "Server is temporarily unavailable. Please try again in a few moments."
        );
      } else if (errorMessage.includes("Invalid")) {
        throw new Error(`Invalid data: ${errorMessage}`);
      } else {
        throw new Error(`Failed to record session stats: ${errorMessage}`);
      }
    }
  },
};