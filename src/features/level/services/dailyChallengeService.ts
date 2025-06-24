import { authFetch } from "@/features/auth/utils/authFetch";
import { generateDailyChallenge } from "@/features/level/utils/challengeHelpers";
import { DailyChallenge } from "../types/level";
import { getUserLevelWithFallback } from "@/features/level/utils/userLevelHelpers";
import { SessionData } from "../types/level";

/**
 * Fetches daily challenge from API with authentication
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
    return await authFetch<DailyChallenge>(
      `/api/challenge/v1/daily`,
      {
        signal: abortController?.signal,
        userId,
        requestId,
      }
    );
  } catch (error) {
    const userLevel = await getUserLevelWithFallback(userId);
    return generateDailyChallenge(userId, userLevel);
  }
};


/**
 * Updates daily challenge progress on the server
 * @param challengeId - ID of the challenge to update
 * @param session - Session progress data
 * @param userId - Current user ID
 * @returns Promise resolving to updated challenge data
 * @throws Error if update fails
 */
interface ChallengeUpdateData {
  wpm: number;
  accuracy: number;
  completedAt?: Date;
}

export const updateDailyChallenge = async (
  challengeId: string,
  session: SessionData,
  userId: string
): Promise<DailyChallenge> => {
  return authFetch<DailyChallenge>(
    `/api/challenge/v1/daily/${challengeId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
      userId,
    }
  );
};