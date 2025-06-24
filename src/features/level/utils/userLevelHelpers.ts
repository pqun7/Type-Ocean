
/**
 * Gets user level with fallback to default
 * @param userId - Current user ID
 * @returns User level or default level of 1
 */
export const getUserLevelWithFallback = async (userId: string): Promise<number> => {
  try {
    // Try to get level from localStorage first (client-side cache)
    const storedLevel = localStorage.getItem(`user:${userId}:level`);
    if (storedLevel) {
      const level = parseInt(storedLevel, 10);
      if (!isNaN(level) && level > 0) {
        return level;
      }
    }

    // Fallback to default level
    return 1;
  } catch (error) {
    console.warn("Failed to retrieve user level, using default:", error);
    return 1;
  }
};