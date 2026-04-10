import { and, eq, isNotNull, sql } from "drizzle-orm";

import { playerProfiles, pvpParticipants, sessionStats } from "../../../../src/db/schema";
import { gatewayLogWarn } from "../shared/logger";
import { extractAverageWpm, extractBestWpm, extractAvgAcc } from "../shared/errors";
import type { GatewayDb } from "../gateway-db";
import type { RedisBus } from "../redis-bus";

export type GatewayResolvedLongTermStats = {
  raw: unknown;
  averageWpm: number | null;
  bestWpm: number | null;
  avgAcc: number | null;
  source: "redis" | "player_profile" | "pvp_participants" | "session_stats" | "none";
};

export async function loadGatewayLongTermStats(params: {
  db: GatewayDb;
  redisBus: RedisBus | null;
  userId: string;
  logContext: string;
  profileLongTermStats?: unknown;
  hasProfileLongTermStats?: boolean;
}): Promise<GatewayResolvedLongTermStats> {
  let longTermStats: unknown = null;
  let source: GatewayResolvedLongTermStats["source"] = "none";

  if (params.redisBus) {
    try {
      const hashData = await params.redisBus.redis.hgetall(`user:longterm:${params.userId}`);
      if (hashData && typeof hashData.averageWPM !== "undefined") {
        longTermStats = {
          averageWPM: parseFloat(hashData.averageWPM) || 0,
          bestWPM: parseFloat(hashData.bestWPM ?? "0") || 0,
          averageAccuracy: parseFloat(hashData.averageAccuracy ?? "0") || 0,
        };
        source = "redis";
      }
    } catch (error) {
      gatewayLogWarn(`Redis longTermStats read failed in ${params.logContext}`, {
        userId: params.userId,
        error: String(error),
      });
    }
  }

  if (extractAverageWpm(longTermStats) === null) {
    if (params.hasProfileLongTermStats) {
      longTermStats = params.profileLongTermStats ?? null;
    } else {
      try {
        const profileRow = await params.db.query.playerProfiles.findFirst({
          columns: { longTermStats: true },
          where: eq(playerProfiles.userId, params.userId),
        });
        longTermStats = profileRow?.longTermStats ?? null;
      } catch (error) {
        gatewayLogWarn(`Failed to load longTermStats from playerProfiles in ${params.logContext}`, {
          userId: params.userId,
          error: String(error),
        });
      }
    }

    if (extractAverageWpm(longTermStats) !== null) {
      source = "player_profile";
    }
  }

  if (extractAverageWpm(longTermStats) === null && process.env.ENABLE_PVP_STATS_AGGREGATE_FALLBACK !== "false") {
    try {
      const [pvpRow] = await params.db
        .select({
          avgWpm: sql<number>`AVG(${pvpParticipants.finalWpm})`,
          maxWpm: sql<number>`MAX(${pvpParticipants.finalWpm})`,
          avgAcc: sql<number>`AVG(${pvpParticipants.finalAccuracy})`,
        })
        .from(pvpParticipants)
        .where(and(eq(pvpParticipants.userId, params.userId), isNotNull(pvpParticipants.finalWpm)));
      if (pvpRow?.avgWpm) {
        longTermStats = {
          averageWPM: Math.round(pvpRow.avgWpm),
          bestWPM: Math.round(pvpRow.maxWpm ?? pvpRow.avgWpm),
          averageAccuracy: Number(Number(pvpRow.avgAcc ?? 0).toFixed(1)),
        };
        source = "pvp_participants";
      }
    } catch (error) {
      gatewayLogWarn(`pvpParticipants stats fallback failed in ${params.logContext}`, {
        userId: params.userId,
        error: String(error),
      });
    }
  }

  if (extractAverageWpm(longTermStats) === null && process.env.ENABLE_PVP_STATS_AGGREGATE_FALLBACK !== "false") {
    try {
      const [sessRow] = await params.db
        .select({
          avgWpm: sql<number>`AVG(${sessionStats.avgWpm})`,
          maxWpm: sql<number>`MAX(${sessionStats.avgWpm})`,
          avgAcc: sql<number>`AVG(${sessionStats.avgAcc})`,
        })
        .from(sessionStats)
        .where(eq(sessionStats.userId, params.userId));
      if (sessRow?.avgWpm) {
        longTermStats = {
          averageWPM: Math.round(sessRow.avgWpm),
          bestWPM: Math.round(sessRow.maxWpm ?? sessRow.avgWpm),
          averageAccuracy: Number(Number(sessRow.avgAcc ?? 0).toFixed(1)),
        };
        source = "session_stats";
      }
    } catch (error) {
      gatewayLogWarn(`sessionStats fallback failed in ${params.logContext}`, {
        userId: params.userId,
        error: String(error),
      });
    }
  }

  return {
    raw: longTermStats,
    averageWpm: extractAverageWpm(longTermStats),
    bestWpm: extractBestWpm(longTermStats),
    avgAcc: extractAvgAcc(longTermStats),
    source,
  };
}