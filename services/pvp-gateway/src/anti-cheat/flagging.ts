import { sql } from "drizzle-orm";

import { cheatFlags } from "../../../../src/db/schema";
import type { GatewayDb } from "../gateway-db";
import { incrementGatewayMetric } from "../metrics";
import { readJsonValue, writeJsonValue, type RedisLike } from "./store";

export const FLAG_THRESHOLD = 0.75;
export const AUTO_SANCTION_THRESHOLD = 0.95;
const FLAG_SCORE_TTL_SECONDS = 7 * 24 * 60 * 60;

type UserFlagSummary = {
  totalFlags: number;
  emaConfidence: number;
  lastFlagAt: number;
};

export async function recordCheatAssessment(params: {
  db: GatewayDb;
  userId: string;
  matchId: string;
  confidence: number;
  flags: string[];
  redis?: RedisLike | null;
  metadata?: Record<string, unknown>;
}) {
  const redis = params.redis ?? null;
  const metadata = params.metadata;
  const summaryKey = `pvp:anti-cheat:v2:flag-summary:${params.userId}`;
  const existingSummary = (await readJsonValue<UserFlagSummary>(redis, summaryKey)) ?? {
    totalFlags: 0,
    emaConfidence: 0,
    lastFlagAt: 0,
  };

  const nextSummary: UserFlagSummary = {
    totalFlags: existingSummary.totalFlags,
    emaConfidence: existingSummary.emaConfidence === 0 ? params.confidence : existingSummary.emaConfidence * 0.8 + params.confidence * 0.2,
    lastFlagAt: existingSummary.lastFlagAt,
  };

  if (!params.flags.length || params.confidence < FLAG_THRESHOLD) {
    await writeJsonValue(redis, summaryKey, nextSummary, FLAG_SCORE_TTL_SECONDS);
    return { persisted: false, wouldSanction: false, totalFlags: nextSummary.totalFlags };
  }

  nextSummary.totalFlags += 1;
  nextSummary.lastFlagAt = Date.now();
  const wouldSanction = params.confidence >= AUTO_SANCTION_THRESHOLD || nextSummary.totalFlags >= 3;
  const baseValues = {
    userId: params.userId,
    matchId: params.matchId,
    confidence: params.confidence,
    flags: params.flags,
    wouldSanction,
    metadata,
  };

  try {
    await params.db
      .insert(cheatFlags)
      .values(baseValues)
      .onConflictDoUpdate({
        target: [cheatFlags.userId, cheatFlags.matchId],
        set: {
          confidence: params.confidence,
          flags: params.flags,
          wouldSanction,
          metadata,
          updatedAt: sql`now()`,
        },
      });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("no unique or exclusion constraint")) {
      await writeJsonValue(redis, summaryKey, nextSummary, FLAG_SCORE_TTL_SECONDS);
      return { persisted: false, wouldSanction, totalFlags: nextSummary.totalFlags };
    }

    try {
      await params.db.insert(cheatFlags).values(baseValues);
    } catch {
      await writeJsonValue(redis, summaryKey, nextSummary, FLAG_SCORE_TTL_SECONDS);
      return { persisted: false, wouldSanction, totalFlags: nextSummary.totalFlags };
    }
  }

  await writeJsonValue(redis, summaryKey, nextSummary, FLAG_SCORE_TTL_SECONDS);
  incrementGatewayMetric("pvp_anti_cheat_flags_total", { wouldSanction });

  return { persisted: true, wouldSanction, totalFlags: nextSummary.totalFlags };
}