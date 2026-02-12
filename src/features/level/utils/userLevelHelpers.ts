
/**
 * Gets user level with fallback to default
 * @param userId - Current user ID
 * @returns User level or default level of 1
 */
export const getUserLevelWithFallback = async (userId: string): Promise<number> => {
  try {
    // Anti-cheat: do not trust client-side persisted state.
    // Fetch server-backed progress (best-effort).
    const res = await fetch("/api/profile/progress", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!res.ok) return 1;
    const data = (await res.json()) as { progress?: { level?: unknown } };
    const level = Number(data?.progress?.level);
    return Number.isFinite(level) && level > 0 ? level : 1;
  } catch (error) {
    console.warn("Failed to retrieve user level, using default:", error);
    return 1;
  }
};