import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { playerProfiles, users } from "@/db/schema";

type PlayerProfileSelectArg = Record<string, boolean> | undefined;

type PlayerProfileCreateOverrides = Partial<
  Pick<
    typeof playerProfiles.$inferInsert,
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

type PlayerProfileUpdateInput = Partial<
  Pick<
    typeof playerProfiles.$inferInsert,
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

type PlayerProfileResult<TSelect extends PlayerProfileSelectArg> = TSelect extends Record<string, boolean>
  ? Record<string, unknown>
  : typeof playerProfiles.$inferSelect;

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
): typeof playerProfiles.$inferInsert {
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

function applySelect<TSelect extends PlayerProfileSelectArg>(
  profile: typeof playerProfiles.$inferSelect,
  select?: TSelect,
): PlayerProfileResult<TSelect> {
  if (!select) {
    return profile as PlayerProfileResult<TSelect>;
  }

  const projected = Object.fromEntries(
    Object.entries(select)
      .filter(([, enabled]) => !!enabled)
      .map(([key]) => [key, (profile as Record<string, unknown>)[key]]),
  );

  return projected as PlayerProfileResult<TSelect>;
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
  update?: PlayerProfileUpdateInput;
  select?: TSelect;
}): Promise<PlayerProfileResult<TSelect>> {
  return db.transaction(async (tx) => {
    const userRows = await tx
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    const user = userRows[0] ?? null;

    if (!user) {
      throw new PlayerProfileUserNotFoundError(params.userId);
    }

    const profileRows = await tx
      .select()
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, params.userId))
      .limit(1);

    const profileExists = profileRows[0] ?? null;

    if (profileExists) {
      if (!params.update || Object.keys(params.update).length === 0) {
        return applySelect(profileExists, params.select);
      }

      const updatedRows = await tx
        .update(playerProfiles)
        .set({ ...params.update, updatedAt: new Date() })
        .where(eq(playerProfiles.userId, params.userId))
        .returning();

      const updatedProfile = updatedRows[0] ?? profileExists;

      return applySelect(updatedProfile, params.select);
    }

    const createdRows = await tx
      .insert(playerProfiles)
      .values(
        createPlayerProfileDefaults(
          params.userId,
          params.username ?? user.username,
          params.create,
        ),
      )
      .returning();

    const createdProfile = createdRows[0]!;

    return applySelect(createdProfile, params.select);
  });
}