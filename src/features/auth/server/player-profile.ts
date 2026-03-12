import "server-only";

import { Prisma, type PlayerProfile } from "@prisma/client";

import prisma from "@/features/auth/lib/db";

type PlayerProfileSelectArg = Prisma.PlayerProfileSelect | undefined;

type PlayerProfileCreateOverrides = Partial<
  Pick<
    Prisma.PlayerProfileUncheckedCreateInput,
    | "username"
    | "level"
    | "xp"
    | "rating"
    | "ratingDeviation"
    | "ratingUpdatedAt"
    | "achievements"
    | "longTermStats"
    | "avatar"
    | "hideFromLeaderboard"
  >
>;

type PlayerProfileResult<TSelect extends PlayerProfileSelectArg> =
  TSelect extends Prisma.PlayerProfileSelect
    ? Prisma.PlayerProfileGetPayload<{ select: TSelect }>
    : PlayerProfile;

export class PlayerProfileUserNotFoundError extends Error {
  readonly code = "USER_NOT_FOUND";

  constructor(userId: string) {
    super(`Cannot create or update PlayerProfile for missing user ${userId}`);
    this.name = "PlayerProfileUserNotFoundError";
  }
}

function createPlayerProfileDefaults(
  userId: string,
  username: string,
  overrides?: PlayerProfileCreateOverrides
): Prisma.PlayerProfileUncheckedCreateInput {
  return {
    userId,
    username: overrides?.username ?? username,
    level: overrides?.level ?? 1,
    xp: overrides?.xp ?? 0,
    rating: overrides?.rating ?? 1000,
    ratingDeviation: overrides?.ratingDeviation ?? 350,
    achievements: overrides?.achievements ?? [],
    avatar: overrides?.avatar ?? null,
    ...(overrides?.ratingUpdatedAt !== undefined
      ? { ratingUpdatedAt: overrides.ratingUpdatedAt }
      : {}),
    ...(overrides?.longTermStats !== undefined
      ? { longTermStats: overrides.longTermStats }
      : {}),
    ...(overrides?.hideFromLeaderboard !== undefined
      ? { hideFromLeaderboard: overrides.hideFromLeaderboard }
      : {}),
  };
}

export async function ensurePlayerProfile<TSelect extends PlayerProfileSelectArg = undefined>(params: {
  userId: string;
  username?: string | null;
  create?: PlayerProfileCreateOverrides;
  select?: TSelect;
}): Promise<PlayerProfileResult<TSelect>> {
  return syncPlayerProfile({
    userId: params.userId,
    username: params.username,
    create: params.create,
    update: {},
    select: params.select,
  });
}

export async function syncPlayerProfile<TSelect extends PlayerProfileSelectArg = undefined>(params: {
  userId: string;
  username?: string | null;
  create?: PlayerProfileCreateOverrides;
  update?: Prisma.PlayerProfileUpdateInput;
  select?: TSelect;
}): Promise<PlayerProfileResult<TSelect>> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: params.userId },
      select: { username: true },
    });

    if (!user) {
      throw new PlayerProfileUserNotFoundError(params.userId);
    }

    const profileExists = await tx.playerProfile.findUnique({
      where: { userId: params.userId },
      select: { id: true },
    });

    if (profileExists) {
      if (params.select) {
        const updatedProfile = await tx.playerProfile.update({
          where: { userId: params.userId },
          data: params.update ?? {},
          select: params.select,
        });

        return updatedProfile as PlayerProfileResult<TSelect>;
      }

      const updatedProfile = await tx.playerProfile.update({
        where: { userId: params.userId },
        data: params.update ?? {},
      });

      return updatedProfile as PlayerProfileResult<TSelect>;
    }

    if (params.select) {
      const createdProfile = await tx.playerProfile.create({
        data: createPlayerProfileDefaults(
          params.userId,
          params.username ?? user.username,
          params.create
        ),
        select: params.select,
      });

      return createdProfile as PlayerProfileResult<TSelect>;
    }

    const createdProfile = await tx.playerProfile.create({
      data: createPlayerProfileDefaults(
        params.userId,
        params.username ?? user.username,
        params.create
      ),
    });

    return createdProfile as PlayerProfileResult<TSelect>;
  });
}