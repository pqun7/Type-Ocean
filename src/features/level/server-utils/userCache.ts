import prisma from '@/lib/db';
import client, { connectIfNeeded } from '@/lib/redis';
import { PlayerProfile, User } from '@prisma/client';
import { logging } from '@/log/ServerLogger';

// Cache configuration
const PROFILE_CACHE_TTL = 3600; // 1 hour in seconds

/**
 * Caches user level information in Redis with TTL
 * @param userId - Target user ID
 * @param level - Current level to cache
 */
export async function cacheLevel(userId: string, level: number): Promise<void> {
  try {
    await connectIfNeeded();
    const cacheKey = `user:${userId}:level`;
    await client.setEx(cacheKey, PROFILE_CACHE_TTL, level.toString());
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
    await client.setEx(cacheKey, PROFILE_CACHE_TTL, xp.toString());
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
    await client.setEx(cacheKey, PROFILE_CACHE_TTL, JSON.stringify({
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
      logging.warn(`[CACHE] Profile not found for ${userId}, using fallback`);
      throw new Error('FALLBACK_NEEDED');
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

    // Fallback to database
    const profile = await prisma.playerProfile.findUnique({
      where: { userId },
      select: { level: true }
    });

    if (!profile) {
      throw new Error('USER_PROFILE_NOT_FOUND');
    }

    // Update cache
    await client.setEx(CACHE_KEY, PROFILE_CACHE_TTL, profile.level.toString());
    return profile.level;

  } catch (error) {
    logging.error(`Failed to retrieve level for user ${userId}:`, error);
    throw error;
  }
}