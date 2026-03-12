export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import prisma from "@/features/auth/lib/db";
import { authorizeRequest } from "@/app/api/shared.server";
import { logging } from "@/log/ServerLogger";
import { rateLimiter } from "@/lib/rate-limiter";
import { MatchmakingPreferenceSchema } from "@/lib/validation/pvp-api-schemas";

const DEFAULT_PVP_PREFERENCE = {
  mode: "ranked_1v1" as const,
  textDifficulty: "normal" as const,
};
const PVP_PREFERENCE_TABLE_RETRY_MS = 60_000;

let hasPvpMatchmakingPreferenceTable: boolean | null = null;
let hasLoggedMissingPvpMatchmakingPreferenceTableWarning = false;
let pvpMatchmakingPreferenceTableLastCheckedAt = 0;

function isMissingPvpMatchmakingPreferenceTable(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2021") return false;

  const table = String(error.meta?.table ?? "").toLowerCase();
  return table.includes("pvp_matchmaking_preference");
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
    migrationHint: "Run Prisma migrations to add pvp_matchmaking_preference",
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
    const preference = await prisma.pvpMatchmakingPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { preferredMode: true, textDifficulty: true, updatedAt: true },
    });

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
    const preference = await prisma.pvpMatchmakingPreference.upsert({
      where: { userId },
      update: {
        preferredMode: parsed.data.mode,
        textDifficulty: parsed.data.textDifficulty,
      },
      create: {
        userId,
        preferredMode: parsed.data.mode,
        textDifficulty: parsed.data.textDifficulty,
      },
      select: { preferredMode: true, textDifficulty: true, updatedAt: true },
    });

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