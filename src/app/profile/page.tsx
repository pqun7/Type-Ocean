// src/app/profile/page.tsx
import { redirect } from "next/navigation";
import { and, count, desc, eq, gt, or } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { SignOut } from "@/components/auth/sign-out";
import { db } from "@/db";
import { dailyTypingActivity, playerProfiles, users } from "@/db/schema";
import {
  getDefaultLongTermStats,
  getLongTermCumulativeStats,
  getSessionHistory,
} from "@/helper/session-stats";
import { getOverallKeyboardPerformance } from "@/helper/overall-keyboard-performance";
import { getRankInfo } from "@/features/ranking/rating";
import { ensurePlayerProfile } from "@/features/auth/server/player-profile";
import {
  getDatabaseErrorCode,
  isDatabaseAccountHoldError,
  isDatabaseTemporarilyUnavailableError,
} from "@/lib/db-error-utils";

import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth?form=login");
  }

  type ProfileDbUser = {
    id: string;
    username: string;
    usernameLastChangedAt: Date | null;
    email: string;
    pendingEmail: string | null;
    pendingEmailRequestedAt: Date | null;
    emailVerifyOtpSentAt: Date | null;
    emailVerified: Date | null;
    passwordHash: string | null;
    image: string | null;
    createdAt: Date;
    profile: {
      level: number;
      xp: number;
      rating: number;
      updatedAt: Date;
      hideFromLeaderboard: boolean;
      achievements: unknown;
      avatar: string | null;
    } | null;
  };

  type ProfilePageUser = Omit<ProfileDbUser, "passwordHash"> & {
    hasPassword: boolean;
  };

  let user: ProfilePageUser | null = null;

  try {
    const dbUser = (await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: {
        id: true,
        username: true,
        usernameLastChangedAt: true,
        email: true,
        pendingEmail: true,
        pendingEmailRequestedAt: true,
        emailVerifyOtpSentAt: true,
        emailVerified: true,
        passwordHash: true,
        image: true,
        createdAt: true,
      },
      with: {
        profile: {
          columns: {
            level: true,
            xp: true,
            rating: true,
            updatedAt: true,
            hideFromLeaderboard: true,
            achievements: true,
            avatar: true,
          },
        },
      },
    })) as ProfileDbUser | undefined;

    if (dbUser) {
      const { passwordHash, ...safeUser } = dbUser;
      user = { ...safeUser, hasPassword: !!passwordHash };
    } else {
      user = null;
    }
  } catch (err) {
    const code = getDatabaseErrorCode(err);
    console.error("/profile db.users.findFirst failed", { code, err });

    const isNetworkLike = isDatabaseTemporarilyUnavailableError(err);
    const isAccountHold = isDatabaseAccountHoldError(err);

    return (
      <div className="min-h-svh bg-[#0a0a1f] p-6 md:p-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="mb-8 text-4xl font-bold text-[#E0E7FF]">Profile</h1>

          <div className="space-y-6">
            <div className="border-b border-white/10 pb-4">
              <h2 className="text-2xl font-semibold text-[#E0E7FF]">
                Temporarily unavailable
              </h2>
              <p className="mt-2 text-[#8A8FB5]">
                {isAccountHold
                  ? "Database access is temporarily blocked by the hosting plan limit. Please resolve the database provider account hold and try again."
                  : isNetworkLike
                  ? "We couldn’t reach the database service. Please try again in a moment."
                  : "We couldn’t load your profile right now. Please try again later."}
              </p>
            </div>

            <div>
              <h2 className="mb-4 text-2xl font-semibold text-[#E0E7FF]">
                Account
              </h2>
              <SignOut className="w-full rounded-lg border border-[#69d0ff] py-5 font-medium text-[#60a5fa] transition-colors duration-300 hover:bg-[#69d0ff]/20 hover:text-[#93c5fd] md:w-auto" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    redirect("/auth?form=login");
  }

  let { profile } = user;
  if (!profile) {
    try {
      profile = (await ensurePlayerProfile({
        userId: user.id,
        username: user.username,
        select: {
          level: true,
          xp: true,
          rating: true,
          updatedAt: true,
          hideFromLeaderboard: true,
          achievements: true,
          avatar: true,
        },
      })) as NonNullable<ProfileDbUser["profile"]>;
    } catch (err) {
      const code = getDatabaseErrorCode(err);
      console.error("/profile db.playerProfiles profile ensure failed", { code, err });
      profile = {
        level: 1,
        xp: 0,
        rating: 1000,
        updatedAt: new Date(),
        hideFromLeaderboard: false,
        achievements: [],
        avatar: null,
      };
    }
  }

  let isTopOnePercent = false;
  if (!profile.hideFromLeaderboard) {
    try {
      const totalRankedRows = await db
        .select({ value: count() })
        .from(playerProfiles)
        .where(eq(playerProfiles.hideFromLeaderboard, false));

      const totalRanked = totalRankedRows[0]?.value ?? 0;

      const cutoff = Math.max(1, Math.ceil(totalRanked * 0.01));

      const betterCountRows = await db
        .select({ value: count() })
        .from(playerProfiles)
        .where(
          and(
            eq(playerProfiles.hideFromLeaderboard, false),
            or(
              gt(playerProfiles.rating, profile.rating),
              and(eq(playerProfiles.rating, profile.rating), gt(playerProfiles.updatedAt, profile.updatedAt)),
            ),
          ),
        );

      const betterCount = betterCountRows[0]?.value ?? 0;

      const position = betterCount + 1;
      isTopOnePercent = position <= cutoff;
    } catch {
      // best-effort; do not block profile
      isTopOnePercent = false;
    }
  }

  let stats = getDefaultLongTermStats();
  try {
    stats = await getLongTermCumulativeStats(user.id);
  } catch {
    // Keep default stats if Redis is unavailable
  }

  let dailyActivity: Array<{
    localDate: string;
    sessionsCount: number;
    totalTimeSpentSec: number;
    sumWpm: number;
    sumWpmTime: number;
    sumAccuracy: number;
  }> = [];

  try {
    dailyActivity = await db
      .select({
        localDate: dailyTypingActivity.localDate,
        sessionsCount: dailyTypingActivity.sessionsCount,
        totalTimeSpentSec: dailyTypingActivity.totalTimeSpentSec,
        sumWpm: dailyTypingActivity.sumWpm,
        sumWpmTime: dailyTypingActivity.sumWpmTime,
        sumAccuracy: dailyTypingActivity.sumAccuracy,
      })
      .from(dailyTypingActivity)
      .where(eq(dailyTypingActivity.userId, user.id))
      .orderBy(desc(dailyTypingActivity.localDate))
      .limit(370);
  } catch {
    dailyActivity = [];
  }

  let sessionHistory: Array<{
    id: string;
    timestamp: string;
    textType?: "SHORT" | "MEDIUM" | "LONG";
    textLength: number;
    wpm?: number;
    accuracy?: number;
    consistency?: number;
    timeSpent?: number;
    mistakes?: number;
    corrections?: number;
    localDate?: string;
  }> = [];

  try {
    const recentSessions = await getSessionHistory(user.id, 100);
    sessionHistory = recentSessions.map((session) => ({
      id: session.id,
      timestamp: session.timestamp,
      textType: session.textType,
      textLength: session.textLength,
      wpm: session.wpm,
      accuracy: session.accuracy,
      consistency: session.consistency,
      timeSpent: session.timeSpent,
      mistakes: session.mistakes,
      corrections: session.corrections,
      localDate: session.localDate,
    }));
  } catch {
    sessionHistory = [];
  }

  const overallKeyboardPerformance = await getOverallKeyboardPerformance(user.id);

  return (
    <div className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        {/* <h1 className="mb-8 text-4xl font-bold text-[#E0E7FF]">Profile</h1> */}

        <ProfileClient
          user={{
            id: user.id,
            username: user.username,
            usernameLastChangedAt: user.usernameLastChangedAt
              ? user.usernameLastChangedAt.toISOString()
              : null,
            email: user.email,
            pendingEmail: user.pendingEmail,
            pendingEmailRequestedAt: user.pendingEmailRequestedAt
              ? user.pendingEmailRequestedAt.toISOString()
              : null,
            emailVerifyOtpSentAt: user.emailVerifyOtpSentAt
              ? user.emailVerifyOtpSentAt.toISOString()
              : null,
            emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
            image: user.image,
            hasPassword: user.hasPassword,
            createdAt: user.createdAt.toISOString(),
          }}
          profile={{
            level: profile.level,
            xp: profile.xp,
            rating: profile.rating,
            achievementsCount: Array.isArray(profile.achievements)
              ? profile.achievements.length
              : 0,
            achievements: Array.isArray(profile.achievements)
              ? (profile.achievements as Array<{ id: string; unlocked: boolean; progress?: { current: number; target: number } }>)
              : [],
            avatar: profile.avatar,
            rank: getRankInfo(profile.rating),
            isTopOnePercent,
          }}
          stats={stats}
          dailyActivity={dailyActivity}
          sessionHistory={sessionHistory}
          overallKeyboardPerformance={overallKeyboardPerformance}
        />

        {/* <div className="mt-16 border-t border-white/10 pt-8">
          <h2 className="mb-4 text-2xl font-semibold text-[#E0E7FF]">Account</h2>
          <SignOut className="w-full rounded-lg border border-[#69d0ff] py-5 font-medium text-[#60a5fa] transition-colors duration-300 hover:bg-[#69d0ff]/20 hover:text-[#93c5fd] md:w-auto" />
        </div> */}
      </div>
    </div>
  );
}
