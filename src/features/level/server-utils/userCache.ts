import prisma from '@/features/auth/lib/db';
import { redis as client, connectIfNeeded } from '@/lib/redis';
import { PlayerProfile, User } from '@prisma/client';
import { logging } from '@/log/ServerLogger';
import { calculateNextLevelXP } from "@/features/level/utils/xpMath";

// Cache configuration
const PROFILE_CACHE_TTL = 3600; // 1 hour in seconds
const PROGRESS_CACHE_TTL = 300; // 5 minutes (UI bootstrap optimization)

type CachedProgressPayload = {
  v: 1;
  level: number;
  xp: number;
  achievements: unknown;
  cachedAt: number;
};

async function cacheProgress(userId: string, payload: { level: number; xp: number; achievements: unknown }): Promise<void> {
  try {
    await connectIfNeeded();
    const key = `user:${userId}:progress`;
    const value: CachedProgressPayload = {
      v: 1,
      level: payload.level,
      xp: payload.xp,
      achievements: payload.achievements,
      cachedAt: Date.now(),
    };
    await client.setex(key, PROGRESS_CACHE_TTL, JSON.stringify(value));
  } catch {
    // ignore (best-effort)
  }
}

async function getCachedProgress(userId: string): Promise<{ level: number; xp: number; achievements: unknown } | null> {
  try {
    await connectIfNeeded();
    const key = `user:${userId}:progress`;
    const raw = await client.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedProgressPayload>;
    if (parsed?.v !== 1) return null;

    const level = Number(parsed.level);
    const xp = Number(parsed.xp);
    if (!Number.isFinite(level) || !Number.isFinite(xp)) return null;

    return {
      level,
      xp,
      achievements: parsed.achievements ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Caches user level information in Redis with TTL
 * @param userId - Target user ID
 * @param level - Current level to cache
 */
export async function cacheLevel(userId: string, level: number): Promise<void> {
  try {
    await connectIfNeeded();
    const cacheKey = `user:${userId}:level`;
    await client.setex(cacheKey, PROFILE_CACHE_TTL, level.toString());
  } catch (error) {
    logging.error(`Level caching failed for user ${userId}:`, error);
  }
}

/**
 * Caches user XP (Experience Points) in Redis with TTL
 * @param userId - Target user ID
 * @param xp - Current XP to cache
 */
export async function cacheXP(userId: string, xp: number): Promise<void> {
  try {
    await connectIfNeeded();
    const cacheKey = `user:${userId}:xp`;
    await client.setex(cacheKey, PROFILE_CACHE_TTL, xp.toString());
  } catch (error) {
    logging.error(`XP caching failed for user ${userId}:`, error);
  }
}

/**
 * Caches complete player profile with user relationship
 * @param profile - Full profile object with user data
 * @param cacheKey - Redis key to use for storage
 */
export async function cacheProfile(
  profile: PlayerProfile & { user: User },
  cacheKey: string
): Promise<void> {
  try {
    await connectIfNeeded();
    await client.setex(cacheKey, PROFILE_CACHE_TTL, JSON.stringify({
      _readOnly: true,
      ...profile,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      user: {
        ...profile.user,
        createdAt: profile.user.createdAt.toISOString(),
        updatedAt: profile.user.updatedAt.toISOString(),
      }
    }));
  } catch (error) {
    logging.error('Profile caching failed:', error);
  }
}

/**
 * Retrieves player profile with cache-aside pattern
 * @param userId - Target user ID
 * @returns Complete player profile with user data
 * @throws Error when fallback handling is required
 */
export async function getCachedProfile(
  userId: string
): Promise<PlayerProfile & { user: User }> {
  const cacheKey = `user:${userId}:profile`;
  logging.debug(`[CACHE] Attempting to fetch profile for ${userId}`);

  try {
    await connectIfNeeded();

    // Attempt cache retrieval
    const cachedData = await client.get(cacheKey);
    if (cachedData) {
      logging.debug(`[CACHE] Cache hit for ${userId}`);
      const parsed = JSON.parse(cachedData);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
        user: {
          ...parsed.user,
          createdAt: new Date(parsed.user.createdAt),
          updatedAt: new Date(parsed.user.updatedAt),
        }
      };
    }

    // Cache miss handling
    logging.debug(`[CACHE] Cache miss for ${userId}`);
    const profile = await prisma.playerProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!profile) {
      logging.warn(`[CACHE] Profile not found for ${userId}, creating default profile`);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });

      const created = await prisma.playerProfile.create({
        data: {
          userId,
          username: user?.username ?? "user",
          level: 1,
          xp: 0,
          achievements: [],
          avatar: null,
        },
        include: { user: true },
      });

      await cacheProfile(created, cacheKey);
      return created;
    }

    // Update cache with fresh data
    await cacheProfile(profile, cacheKey);
    return profile;

  } catch (error) {
    logging.error(`[CACHE] Critical failure for ${userId}:`, error);
    throw error;
  }
}

/**
 * Retrieves user level with cache-first strategy
 * @param userId - Target user ID
 * @returns Current user level
 * @throws Error when profile not found
 */
export async function getUserLevel(userId: string): Promise<number> {
  const CACHE_KEY = `user:${userId}:level`;

  try {
    await connectIfNeeded();

    // Check cache first
    const cachedLevel = await client.get(CACHE_KEY);
    if (cachedLevel) {
      return parseInt(cachedLevel, 10);
    }

    // Fallback to database (ensure profile exists)
    const profile = await ensurePlayerProfile(userId);

    // Update cache
    await client.setex(CACHE_KEY, PROFILE_CACHE_TTL, profile.level.toString());
    return profile.level;

  } catch (error) {
    logging.error(`Failed to retrieve level for user ${userId}:`, error);
    throw error;
  }
}

async function ensurePlayerProfile(userId: string): Promise<PlayerProfile> {
  const existing = await prisma.playerProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });

  return prisma.playerProfile.create({
    data: {
      userId,
      username: user?.username ?? "user",
      level: 1,
      xp: 0,
      achievements: [],
      avatar: null,
    },
  });
}

export async function addUserXP(
  userId: string,
  xpDelta: number
): Promise<{ level: number; xp: number; nextLevelXP: number }> {
  if (!Number.isFinite(xpDelta) || xpDelta <= 0) {
    throw new Error("INVALID_XP_DELTA");
  }

  const profile = await ensurePlayerProfile(userId);

  let nextLevel = Math.max(1, profile.level);
  let nextXP = Math.max(0, profile.xp) + Math.floor(xpDelta);

  // Apply level-ups (xp is stored as remainder towards next level)
  while (nextXP >= calculateNextLevelXP(nextLevel)) {
    nextXP -= calculateNextLevelXP(nextLevel);
    nextLevel += 1;
  }

  const updated = await prisma.playerProfile.update({
    where: { userId },
    data: { level: nextLevel, xp: nextXP },
    select: { level: true, xp: true },
  });

  // Best-effort progress cache update (does not block response)
  cacheProgress(userId, {
    level: updated.level,
    xp: updated.xp,
    achievements: profile.achievements,
  }).catch(() => {
    // ignore
  });

  // Best-effort cache update (do not block response)
  cacheLevel(userId, updated.level).catch((error) => {
    logging.warn("Failed to update level cache", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  cacheXP(userId, updated.xp).catch((error) => {
    logging.warn("Failed to update XP cache", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    level: updated.level,
    xp: updated.xp,
    nextLevelXP: calculateNextLevelXP(updated.level),
  };
}

export async function getUserProgress(userId: string): Promise<{
  level: number;
  xp: number;
  nextLevelXP: number;
  achievements: unknown;
}> {
  const cached = await getCachedProgress(userId);
  if (cached) {
    return {
      level: cached.level,
      xp: cached.xp,
      nextLevelXP: calculateNextLevelXP(cached.level),
      achievements: cached.achievements,
    };
  }

  const profile = await ensurePlayerProfile(userId);
  const result = {
    level: profile.level,
    xp: profile.xp,
    nextLevelXP: calculateNextLevelXP(profile.level),
    achievements: profile.achievements,
  };

  cacheProgress(userId, {
    level: result.level,
    xp: result.xp,
    achievements: result.achievements,
  }).catch(() => {
    // ignore
  });

  return result;
}

export const updateUserLevel = async (userId: string, newLevel: number, newXP: number) => {
  try {
    logging.info("Starting level update", { userId, newLevel, newXP });

    // Update database
    logging.debug("Updating player profile in database", { userId, newLevel, newXP });
    const updatedProfile = await prisma.playerProfile.update({
      where: { userId },
      data: {
        level: newLevel,
        xp: newXP,
      },
    });
    logging.info("Player profile updated successfully", { userId, level: updatedProfile.level, xp: updatedProfile.xp });

    // Update cache
    logging.debug("Updating cache for level and XP", { userId });
    await cacheLevel(userId, updatedProfile.level);
    await cacheXP(userId, updatedProfile.xp);
    logging.debug("Cache updated successfully", { userId });

    logging.info("Level update completed successfully", { userId });
    return { success: true, profile: updatedProfile };
  } catch (error) {
    logging.error("Failed to update user level", error, { userId, newLevel, newXP });
    return { success: false, error: 'LEVEL_UPDATE_FAILED' };
  }
};
