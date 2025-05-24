import { authFetch } from "@/features/auth/utils/authFetch";
import { generateDailyChallenge } from "@/features/level/utils/challengeHelpers";
import { DailyChallenge } from "../types/level";

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
    const response: Response = await authFetch(
      `/api/daily-challenge`,
      {
        signal: abortController?.signal,
        headers: requestId ? { "X-Request-ID": requestId } : undefined,
      },
      userId
    );

    if (!response.ok) throw new Error("Failed to fetch challenge");
    return await response.json();
  } catch (error) {
    const userLevel = 1; // TODO: Replace with actual user level determination logic
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
export const updateDailyChallenge = async (
  challengeId: string,
  session: any,
  userId: string
) => {
  const response = (await authFetch(
    `/api/daily-challenge/${challengeId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress: session }),
    },
    userId
  )) as Response;

  if (!response.ok) throw new Error("Challenge update failed");
  return response.json();
};