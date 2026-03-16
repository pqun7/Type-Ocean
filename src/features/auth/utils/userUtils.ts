import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerProfiles, users } from "@/db/schema";

type EmergencyUser = {
  id: string;
  email: string;
  role: string;
  pendingEmail: string | null;
  pendingEmailRequestedAt: Date | null;
  emailVerified: Date | null;
  banned: boolean;
  isPrimaryAdmin: boolean;
  username: string;
  usernameLastChangedAt: Date | null;
  passwordHash: string | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
  passwordResetRequests: number;
  emailVerifyToken: string | null;
  emailVerifyTokenExpiry: Date | null;
  emailVerificationAttempts: number | null;
  emailVerifyOtpHash: string | null;
  emailVerifyOtpExpiry: Date | null;
  emailVerifyOtpSentAt: Date | null;
  emailVerifyOtpFailedAttempts: number;
  pvpWsTokenVersion: number;
  pvpWsTokensValidAfter: Date;
  verificationReminderShownAt: Date | null;
};

type EmergencyPlayerProfile = {
  id: string;
  userId: string;
  username: string;
  level: number;
  xp: number;
  rating: number;
  ratingDeviation: number;
  ratingUpdatedAt: Date | null;
  achievements: unknown;
  longTermStats: unknown;
  avatar: string | null;
  hideFromLeaderboard: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: EmergencyUser;
};

// 🔹 إنشاء ملف طوارئ مؤقت
export function generateEmergencyProfile(userId: string): EmergencyPlayerProfile {
  return {
    id: 'emergency-profile',
    userId,
    username: 'Guest',
    level: 1,
    xp: 0,
    rating: 1000,
    ratingDeviation: 350,
    ratingUpdatedAt: null,
    achievements: [],
    longTermStats: null,
    avatar: null,
    hideFromLeaderboard: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: userId,
      email: 'fallback@example.com',
      role: 'user',
      pendingEmail: null,
      pendingEmailRequestedAt: null,
      emailVerified: null,
      banned: false,
      isPrimaryAdmin: false,
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
      pvpWsTokenVersion: 0,
      pvpWsTokensValidAfter: new Date(),
      verificationReminderShownAt: null,
    },
  };
}

// 🔹 استرجاع ملف الطوارئ عند الحاجة (من API server فقط!)
export async function getFallbackProfile(userId: string): Promise<EmergencyPlayerProfile> {
  try {
    const rows = await db
      .select({
        profile: playerProfiles,
        user: users,
      })
      .from(playerProfiles)
      .innerJoin(users, eq(playerProfiles.userId, users.id))
      .where(eq(playerProfiles.userId, userId))
      .limit(1);

    const row = rows[0] ?? null;

    const profile = row
      ? {
          ...row.profile,
          user: row.user,
        }
      : null;

    if (profile) return profile;

    throw new Error('CORRUPTED_USER_PROFILE');
  } catch (error) {
    console.error('Profile recovery failed:', error);
    return generateEmergencyProfile(userId);
  }
}
