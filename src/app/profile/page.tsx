import { redirect } from "next/navigation";

import { auth } from "@/features/auth/lib/auth";
import { SignOut } from "@/components/auth/sign-out";
import prisma from "@/features/auth/lib/db";
import { getDefaultLongTermStats, getLongTermCumulativeStats } from "@/helper/session-stats";
import type { Prisma } from "@prisma/client";

import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getPrismaErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  if (!("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
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
      emailVerified: true;
      passwordHash: true;
      image: true;
      createdAt: true;
      profile: {
        select: {
          level: true;
          xp: true;
          achievements: true;
          avatar: true;
        };
      };
    };
  }>;

  type ProfilePageUser = Omit<ProfileDbUser, "passwordHash"> & { hasPassword: boolean };

  let user: ProfilePageUser | null = null;

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        username: true,
        usernameLastChangedAt: true,
        email: true,
        emailVerified: true,
        passwordHash: true,
        image: true,
        createdAt: true,
        profile: {
          select: {
            level: true,
            xp: true,
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

    const isNetworkLike = code === "P5010" || (err instanceof Error && err.message.toLowerCase().includes("fetch failed"));

    return (
      <div className="min-h-svh p-6 md:p-10">
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-semibold text-slate-100">Profile</h1>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <h2 className="text-lg font-medium text-slate-100">Temporarily unavailable</h2>
            <p className="mt-2 text-sm text-slate-300">
              {isNetworkLike
                ? "We couldn’t reach the database service. Please try again in a moment."
                : "We couldn’t load your profile right now. Please try again later."}
            </p>
            {/* <p className="mt-2 text-xs text-slate-400">
              If you’re deploying, double-check your `DATABASE_URL` environment variable.
            </p> */}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <h2 className="text-lg font-medium text-slate-100">Account</h2>
            <div className="mt-3">
              <SignOut />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    redirect("/auth?form=login");
  }

  // Ensure PlayerProfile exists for legacy users
  let profile = user.profile;
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
          achievements: true,
          avatar: true,
        },
      });
    } catch (err) {
      const code = getPrismaErrorCode(err);
      console.error("/profile prisma.playerProfile.upsert failed", { code, err });
      // Keep page alive with minimal defaults.
      profile = { level: 1, xp: 0, achievements: [], avatar: null };
    }
  }

  let stats = getDefaultLongTermStats();
  try {
    stats = await getLongTermCumulativeStats(user.id);
  } catch {
    // Keep default stats if Redis is unavailable
  }

  return (
    <div className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold text-slate-100">Profile</h1>
        <ProfileClient
          user={{
            id: user.id,
            username: user.username,
            usernameLastChangedAt: user.usernameLastChangedAt
              ? user.usernameLastChangedAt.toISOString()
              : null,
            email: user.email,
            emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
            image: user.image,
            hasPassword: user.hasPassword,
            createdAt: user.createdAt.toISOString(),
          }}
          profile={{
            level: profile.level,
            xp: profile.xp,
            achievementsCount: Array.isArray(profile.achievements)
              ? profile.achievements.length
              : 0,
            avatar: profile.avatar,
          }}
          stats={stats}
        />

        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <h2 className="text-lg font-medium text-slate-100">Account</h2>
          <div className="mt-3">
            <SignOut />
          </div>
        </div>
      </div>
    </div>
  );
}
