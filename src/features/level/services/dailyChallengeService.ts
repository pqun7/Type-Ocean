// rc\features\level\services\dailyChallengeService.ts
import { authFetch } from "@/features/auth/utils/authFetch";
import { generateDailyChallenge } from "@/features/level/utils/challengeHelpers";
import { DailyChallenge } from "../types/level";
import { getUserLevelWithFallback } from "@/features/level/utils/userLevelHelpers";
import { SessionData } from "../types/level";
import { logger } from "@/log/clientLogger";

// Configuration constants
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 8000; // 8 seconds
const RETRY_MULTIPLIER = 2;

/**
 * Implements exponential backoff retry logic
 * @param fn - Function to retry
 * @param maxAttempts - Maximum number of retry attempts
 * @returns Promise with retry logic applied
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = MAX_RETRY_ATTEMPTS
): Promise<T> {
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        logger.challenge.error(
          `Final retry attempt failed`,
          lastError
        );
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        BASE_RETRY_DELAY * Math.pow(RETRY_MULTIPLIER, attempt - 1),
        MAX_RETRY_DELAY
      );
      const jitter = Math.random() * 0.1 * baseDelay; // 10% jitter
      const delay = baseDelay + jitter;

      logger.challenge.warn(
        `Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This line is now reachable only if maxAttempts is 0 or negative
  throw lastError;
}

/**
 * Fetches daily challenge from API with authentication and fallback mechanisms
 * @param userId - Current user ID
 * @param abortController - Optional abort controller for request cancellation
 * @param requestId - Optional unique request identifier for tracing
 * @returns Promise resolving to DailyChallenge object
 */
export const fetchDailyChallenge = async (
  userId: string,
  abortController?: AbortController,
  requestId?: string
): Promise<DailyChallenge> => {
  try {
    return await withRetry(async () => {
      return await authFetch<DailyChallenge>(`/api/challenge/v1/daily`, {
        signal: abortController?.signal,
        userId,
        requestId,
      });
    });
  } catch {
    logger.challenge.warn(
      "API fetch failed, generating fallback challenge",
      );

    // Client-side fallback challenge generation
    const userLevel = await getUserLevelWithFallback(userId);
    return generateDailyChallenge(userId, userLevel);
  }
};

/**
 * Updates daily challenge progress on the server with retry logic
 * @param challengeId - ID of the challenge to update
 * @param session - Session progress data
 * @param userId - Current user ID
 * @returns Promise resolving to updated challenge data
 * @throws Error if update fails after all retries
 */
export const updateDailyChallenge = async (
  challengeId: string,
  session: SessionData,
  userId: string
): Promise<DailyChallenge> => {
  return withRetry(async () => {
    return await authFetch<DailyChallenge>(
      `/api/challenge/v1/daily/${challengeId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
        userId,
      }
    );
  });
};

/**
 * Creates a new daily challenge for the user
 * @param userId - Current user ID
 * @param userLevel - User's current level for difficulty scaling
 * @returns Promise resolving to newly created DailyChallenge
 */
export const createDailyChallenge = async (
  userId: string,
  userLevel: number
): Promise<DailyChallenge> => {
  try {
    return await withRetry(async () => {
      return await authFetch<DailyChallenge>(`/api/challenge/v1/daily`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userLevel }),
        userId,
      });
    });
  } catch {
    logger.challenge.warn(
      "Challenge creation API failed, generating locally",
    );

    // Fallback to local generation
    return generateDailyChallenge(userId, userLevel);
  }
};

/**
 * Validates challenge data integrity
 * @param challenge - Challenge object to validate
 * @returns Boolean indicating if challenge is valid
 */
export const validateChallengeData = (challenge: DailyChallenge): boolean => {
  if (!challenge || typeof challenge !== "object") return false;

  const requiredFields = ["id", "date", "type", "target", "xp", "status"];
  const hasAllFields = requiredFields.every((field) => field in challenge);

  if (!hasAllFields) return false;

  // Type-specific validation
  switch (challenge.type) {
    case "speedCombo":
      return (
        typeof challenge.target === "object" &&
        "wpm" in challenge.target &&
        "accuracy" in challenge.target
      );
    case "marathon":
    case "timeAttack":
      return typeof challenge.target === "number" && challenge.target > 0;
    default:
      return false;
  }
};

/**
 * Sanitizes session data before sending to API
 * @param session - Raw session data
 * @returns Sanitized session data
 */
export const sanitizeSessionData = (session: SessionData): SessionData => {
  return {
    wpm: Math.max(0, Math.min(300, Number(session.wpm) || 0)),
    accuracy: Math.max(0, Math.min(100, Number(session.accuracy) || 0)),
    textLength: Math.max(0, Number(session.textLength) || 0),
    timeSpent: Math.max(0, Number(session.timeSpent) || 0),
    errors: Math.max(0, Number(session.errors) || 0),
    dailyAvgWpm: Math.max(0, Number(session.dailyAvgWpm) || 0),
    dailyAvgAcc: Math.max(0, Number(session.dailyAvgAcc) || 0),
    sessionsCount: Math.max(0, Number(session.sessionsCount) || 0),
    textType: session.textType,
  };
};
