import prisma from '@/lib/db';
import client, { connectIfNeeded } from '@/lib/redis';
import { PlayerProfile, User } from '@prisma/client';
import { logging } from '@/log/ServerLogger'; // Add import

const PROFILE_CACHE_TTL = 3600; // 1 ساعة

// 🔹 تخزين المستوى مؤقتًا
export async function cacheLevel(userId: string, level: number): Promise<void> {
  try {
    await connectIfNeeded();
    const cacheKey = `user:${userId}:level`;
    await client.setEx(cacheKey, PROFILE_CACHE_TTL, level.toString());
  } catch (error) {
    logging.error(`Level caching failed for user ${userId}:`, error);
  }
}

// 🔹 تخزين النقاط (XP) مؤقتًا
export async function cacheXP(userId: string, xp: number): Promise<void> {
  try {
    await connectIfNeeded();
    const cacheKey = `user:${userId}:xp`;
    await client.setEx(cacheKey, PROFILE_CACHE_TTL, xp.toString());
  } catch (error) {
    logging.error(`XP caching failed for user ${userId}:`, error);
  }
}

// 🔹 تخزين الملف مؤقتًا
export async function cacheProfile(profile: PlayerProfile & { user: User }, cacheKey: string): Promise<void> {
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

// 🔹 استرجاع الملف من الكاش أو قاعدة البيانات
export async function getCachedProfile(userId: string): Promise<PlayerProfile & { user: User }> {
  const cacheKey = `user:${userId}:profile`;
  logging.debug(`[CACHE] Attempting to fetch profile for ${userId}`);

  try {
    await connectIfNeeded();

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

    logging.debug(`[CACHE] Cache miss for ${userId}`);
    const profile = await prisma.playerProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!profile) {
      logging.warn(`[CACHE] Profile not found for ${userId}, using fallback`);
      throw new Error('FALLBACK_NEEDED');
    }

    await cacheProfile(profile, cacheKey);
    return profile;

  } catch (error) {
    logging.error(`[CACHE] Critical failure for ${userId}:`, error);
    throw error;
  }
}

// 🔹 جلب المستوى مع التخزين المؤقت
export async function getUserLevel(userId: string): Promise<number> {
  const CACHE_KEY = `user:${userId}:level`;

  try {
    await connectIfNeeded();

    const cachedLevel = await client.get(CACHE_KEY);
    if (cachedLevel) {
      return parseInt(cachedLevel, 10);
    }

    const profile = await prisma.playerProfile.findUnique({
      where: { userId },
      select: { level: true }
    });

    if (!profile) {
      throw new Error('USER_PROFILE_NOT_FOUND');
    }

    await client.setEx(CACHE_KEY, PROFILE_CACHE_TTL, profile.level.toString());
    return profile.level;

  } catch (error) {
    logging.error(`Failed to retrieve level for user ${userId}:`, error);
    throw error;
  }
}
