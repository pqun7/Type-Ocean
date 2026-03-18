export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { pvpMatchmakingPreferences } from "@/db/schema";
import { authorizeRequest } from "@/app/api/shared.server";
import { logging } from "@/log/ServerLogger";
import { rateLimiter } from "@/lib/rate-limiter";
import { MatchmakingPreferenceSchema } from "@/lib/validation/pvp-api-schemas";

const DEFAULT_PVP_PREFERENCE = {
  mode: "ranked_1v1" as const,
  textDifficulty: "normal" as const,
};
const PVP_PREFERENCE_TABLE_RETRY_MS = 60_000;
const PVP_MATCHMAKING_PREFERENCES_TABLE = "pvp_matchmaking_preferences";

let hasPvpMatchmakingPreferenceTable: boolean | null = null;
let hasLoggedMissingPvpMatchmakingPreferenceTableWarning = false;
let pvpMatchmakingPreferenceTableLastCheckedAt = 0;

function isMissingPvpMatchmakingPreferenceTable(error: unknown) {
  if (typeof error !== "object" || error === null) return false;

  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  const table = String((error as { meta?: { table?: unknown } }).meta?.table ?? "").toLowerCase();

  if (code === "42P01") {
    if (table.includes(PVP_MATCHMAKING_PREFERENCES_TABLE)) return true;
    if (message.includes(PVP_MATCHMAKING_PREFERENCES_TABLE)) return true;
  }

  return message.includes(`relation \"${PVP_MATCHMAKING_PREFERENCES_TABLE}\"`) && message.includes("does not exist");
}

function buildDefaultPreferenceResponse(
  textDifficulty: "easy" | "normal" | "hard" = DEFAULT_PVP_PREFERENCE.textDifficulty
) {
  return {
    mode: DEFAULT_PVP_PREFERENCE.mode,
    textDifficulty,
    updatedAt: new Date().toISOString(),
  };
}

function logMissingPreferenceTableOnce() {
  if (hasLoggedMissingPvpMatchmakingPreferenceTableWarning) return;

  hasLoggedMissingPvpMatchmakingPreferenceTableWarning = true;
  logging.warn("PvP preference route is using compatibility fallback because the preference table is missing", {
    route: "/api/pvp/preferences",
    migrationHint: `Run database migrations to add ${PVP_MATCHMAKING_PREFERENCES_TABLE}`,
  });
}

async function safeJson(req: NextRequest) {
  const raw = await req.text().catch(() => null);
  if (raw == null) return null;
  if (raw.length === 0) return {};
  if (Buffer.byteLength(raw, "utf8") > 1024) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/preferences:GET");
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  if (
    hasPvpMatchmakingPreferenceTable === false &&
    Date.now() - pvpMatchmakingPreferenceTableLastCheckedAt < PVP_PREFERENCE_TABLE_RETRY_MS
  ) {
    return NextResponse.json(buildDefaultPreferenceResponse(), { headers: rateLimit.headers });
  }

  try {
    await db.insert(pvpMatchmakingPreferences).values({ userId }).onConflictDoNothing({
      target: pvpMatchmakingPreferences.userId,
    });

    const preferenceRows = await db
      .select({
        preferredMode: pvpMatchmakingPreferences.preferredMode,
        textDifficulty: pvpMatchmakingPreferences.textDifficulty,
        updatedAt: pvpMatchmakingPreferences.updatedAt,
      })
      .from(pvpMatchmakingPreferences)
      .where(eq(pvpMatchmakingPreferences.userId, userId))
      .limit(1);

    const preference = preferenceRows[0] ?? {
      preferredMode: DEFAULT_PVP_PREFERENCE.mode,
      textDifficulty: DEFAULT_PVP_PREFERENCE.textDifficulty,
      updatedAt: new Date(),
    };

    hasPvpMatchmakingPreferenceTable = true;
    pvpMatchmakingPreferenceTableLastCheckedAt = Date.now();

    return NextResponse.json(
      {
        mode: preference.preferredMode,
        textDifficulty: preference.textDifficulty,
        updatedAt: preference.updatedAt.toISOString(),
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    if (!isMissingPvpMatchmakingPreferenceTable(error)) {
      throw error;
    }

    hasPvpMatchmakingPreferenceTable = false;
    pvpMatchmakingPreferenceTableLastCheckedAt = Date.now();
    logMissingPreferenceTableOnce();
    return NextResponse.json(buildDefaultPreferenceResponse(), { headers: rateLimit.headers });
  }
}

export async function PATCH(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/preferences:PATCH");
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  const body = await safeJson(req);
  if (body == null) {
    return NextResponse.json({ error: "Invalid PvP preference payload" }, { status: 400, headers: rateLimit.headers });
  }

  const parsed = MatchmakingPreferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid PvP preference payload" }, { status: 400, headers: rateLimit.headers });
  }

  if (
    hasPvpMatchmakingPreferenceTable === false &&
    Date.now() - pvpMatchmakingPreferenceTableLastCheckedAt < PVP_PREFERENCE_TABLE_RETRY_MS
  ) {
    return NextResponse.json(buildDefaultPreferenceResponse(parsed.data.textDifficulty), { headers: rateLimit.headers });
  }

  try {
    await db
      .insert(pvpMatchmakingPreferences)
      .values({
        userId,
        preferredMode: parsed.data.mode,
        textDifficulty: parsed.data.textDifficulty,
      })
      .onConflictDoUpdate({
        target: pvpMatchmakingPreferences.userId,
        set: {
          preferredMode: parsed.data.mode,
          textDifficulty: parsed.data.textDifficulty,
          updatedAt: new Date(),
        },
      });

    const preferenceRows = await db
      .select({
        preferredMode: pvpMatchmakingPreferences.preferredMode,
        textDifficulty: pvpMatchmakingPreferences.textDifficulty,
        updatedAt: pvpMatchmakingPreferences.updatedAt,
      })
      .from(pvpMatchmakingPreferences)
      .where(eq(pvpMatchmakingPreferences.userId, userId))
      .limit(1);

    const preference = preferenceRows[0] ?? {
      preferredMode: parsed.data.mode,
      textDifficulty: parsed.data.textDifficulty,
      updatedAt: new Date(),
    };

    hasPvpMatchmakingPreferenceTable = true;
    pvpMatchmakingPreferenceTableLastCheckedAt = Date.now();

    return NextResponse.json(
      {
        mode: preference.preferredMode,
        textDifficulty: preference.textDifficulty,
        updatedAt: preference.updatedAt.toISOString(),
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    if (!isMissingPvpMatchmakingPreferenceTable(error)) {
      throw error;
    }

    hasPvpMatchmakingPreferenceTable = false;
    pvpMatchmakingPreferenceTableLastCheckedAt = Date.now();
    logMissingPreferenceTableOnce();
    return NextResponse.json(buildDefaultPreferenceResponse(parsed.data.textDifficulty), { headers: rateLimit.headers });
  }
}