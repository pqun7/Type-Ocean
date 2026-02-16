import { PlayerProfile, User } from '@prisma/client';

// 🔹 إنشاء ملف طوارئ مؤقت
export function generateEmergencyProfile(userId: string): PlayerProfile & { user: User } {
  return {
    id: 'emergency-profile',
    userId,
    username: 'Guest',
    level: 1,
    xp: 0,
    achievements: [],
    longTermStats: null,
    avatar: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: userId,
      email: 'fallback@example.com',
      pendingEmail: null,
      pendingEmailRequestedAt: null,
      emailVerified: null,
      username: 'Guest',
      usernameLastChangedAt: null,
      passwordHash: '',
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resetToken: null,
      resetTokenExpiry: null,
      passwordResetRequests: 0,
      emailVerifyToken: null,
      emailVerifyTokenExpiry: null,
      emailVerificationAttempts: 0,
      emailVerifyOtpHash: null,
      emailVerifyOtpExpiry: null,
      emailVerifyOtpSentAt: null,
      emailVerifyOtpFailedAttempts: 0,
      verificationReminderShownAt: null,
    },
  };
}

// 🔹 استرجاع ملف الطوارئ عند الحاجة (من API server فقط!)
import prisma from '@/features/auth/lib/db';

export async function getFallbackProfile(userId: string): Promise<PlayerProfile & { user: User }> {
  try {
    const profile = await prisma.playerProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (profile) return profile;

    throw new Error('CORRUPTED_USER_PROFILE');
  } catch (error) {
    console.error('Profile recovery failed:', error);
    return generateEmergencyProfile(userId);
  }
}
