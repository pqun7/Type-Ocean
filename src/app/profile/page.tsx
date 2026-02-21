// src/app/profile/page.tsx
import { redirect } from "next/navigation";

import { auth } from "@/features/auth/lib/auth";
import { SignOut } from "@/components/auth/sign-out";
import prisma from "@/features/auth/lib/db";
import {
  getDefaultLongTermStats,
  getLongTermCumulativeStats,
  getSessionHistory,
} from "@/helper/session-stats";
import { Prisma } from "@prisma/client";
import { getRankInfo } from "@/features/ranking/rating";

import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getPrismaErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  if (!("code" in err)) return null;
  const { code } = err as { code?: unknown };
  return typeof code === "string" ? code : null;
}

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth?form=login");
  }

  type ProfileDbUser = Prisma.UserGetPayload<{
    select: {
      id: true;
      username: true;
      usernameLastChangedAt: true;
      email: true;
      pendingEmail: true;
      pendingEmailRequestedAt: true;
      emailVerifyOtpSentAt: true;
      emailVerified: true;
      passwordHash: true;
      image: true;
      createdAt: true;
      profile: {
        select: {
          level: true;
          xp: true;
          rating: true;
          achievements: true;
          avatar: true;
        };
      };
    };
  }>;

  type ProfilePageUser = Omit<ProfileDbUser, "passwordHash"> & {
    hasPassword: boolean;
  };

  let user: ProfilePageUser | null = null;

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
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
        profile: {
          select: {
            level: true,
            xp: true,
            rating: true,
            achievements: true,
            avatar: true,
          },
        },
      },
    });

    if (dbUser) {
      const { passwordHash, ...safeUser } = dbUser;
      user = { ...safeUser, hasPassword: !!passwordHash };
    } else {
      user = null;
    }
  } catch (err) {
    const code = getPrismaErrorCode(err);
    console.error("/profile prisma.user.findUnique failed", { code, err });

    const isNetworkLike =
      code === "P5010" ||
      (err instanceof Error && err.message.toLowerCase().includes("fetch failed"));

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
                {isNetworkLike
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
      profile = await prisma.playerProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          username: user.username,
          level: 1,
          xp: 0,
          achievements: [],
          avatar: null,
        },
        select: {
          level: true,
          xp: true,
          rating: true,
          achievements: true,
          avatar: true,
        },
      });
    } catch (err) {
      const code = getPrismaErrorCode(err);
      console.error("/profile prisma.playerProfile.upsert failed", { code, err });
      profile = { level: 1, xp: 0, rating: 1000, achievements: [], avatar: null };
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
    dailyActivity = await prisma.dailyTypingActivity.findMany({
      where: { userId: user.id },
      orderBy: { localDate: "desc" },
      take: 370,
      select: {
        localDate: true,
        sessionsCount: true,
        totalTimeSpentSec: true,
        sumWpm: true,
        sumWpmTime: true,
        sumAccuracy: true,
      },
    });
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
            avatar: profile.avatar,
            rank: getRankInfo(profile.rating),
          }}
          stats={stats}
          dailyActivity={dailyActivity}
          sessionHistory={sessionHistory}
        />

        {/* <div className="mt-16 border-t border-white/10 pt-8">
          <h2 className="mb-4 text-2xl font-semibold text-[#E0E7FF]">Account</h2>
          <SignOut className="w-full rounded-lg border border-[#69d0ff] py-5 font-medium text-[#60a5fa] transition-colors duration-300 hover:bg-[#69d0ff]/20 hover:text-[#93c5fd] md:w-auto" />
        </div> */}
      </div>
    </div>
  );
}