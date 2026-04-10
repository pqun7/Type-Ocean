import { config } from "dotenv";
import Redis from "ioredis";
import { eq } from "drizzle-orm";

config({ path: ".env" });
config({ path: ".env.local", override: false });

const { db } = require("../src/db") as typeof import("../src/db");
const { playerProfiles, users } = require("../src/db/schema") as typeof import("../src/db/schema");

type LongTermStatsSnapshot = {
  averageWPM: number;
  bestWPM: number;
  averageAccuracy: number;
  totalSessions?: number;
  totalTimeTyped?: number;
  totalWordsTyped?: number;
  totalCharactersTyped?: number;
  totalMistakes?: number;
  totalCorrections?: number;
  averageConsistency?: number;
  bestWPMDate?: string | null;
  bestAccuracy?: number;
  bestAccuracyDate?: string | null;
  lastUpdated?: string | null;
};

function parseRedisStats(hash: Record<string, string>): LongTermStatsSnapshot | null {
  if (typeof hash.averageWPM === "undefined") {
    return null;
  }

  return {
    averageWPM: parseFloat(hash.averageWPM) || 0,
    bestWPM: parseFloat(hash.bestWPM ?? "0") || 0,
    averageAccuracy: parseFloat(hash.averageAccuracy ?? "0") || 0,
    totalSessions: parseInt(hash.totalSessions ?? "0", 10) || 0,
    totalTimeTyped: parseInt(hash.totalTimeTyped ?? "0", 10) || 0,
    totalWordsTyped: parseInt(hash.totalWordsTyped ?? "0", 10) || 0,
    totalCharactersTyped: parseInt(hash.totalCharactersTyped ?? "0", 10) || 0,
    totalMistakes: parseInt(hash.totalMistakes ?? "0", 10) || 0,
    totalCorrections: parseInt(hash.totalCorrections ?? "0", 10) || 0,
    averageConsistency: parseFloat(hash.averageConsistency ?? "0") || 0,
    bestWPMDate: hash.bestWPMDate ?? null,
    bestAccuracy: parseFloat(hash.bestAccuracy ?? "0") || 0,
    bestAccuracyDate: hash.bestAccuracyDate ?? null,
    lastUpdated: hash.lastUpdated ?? null,
  };
}

async function main() {
  const redisUrl = process.env.REDIS_URL?.trim() || process.env.NEXT_REDIS_URL?.trim() || process.env.PVP_REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("Missing REDIS_URL/NEXT_REDIS_URL/PVP_REDIS_URL for backfill");
  }

  const redis = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2, enableReadyCheck: true });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const allUsers = await db.select({ userId: users.id, username: users.username }).from(users);

    for (const user of allUsers) {
      scanned += 1;
      const hash = await redis.hgetall(`user:longterm:${user.userId}`);
      const parsed = parseRedisStats(hash);
      if (!parsed) {
        skipped += 1;
        continue;
      }

      const existing = await db
        .select({ id: playerProfiles.id, longTermStats: playerProfiles.longTermStats })
        .from(playerProfiles)
        .where(eq(playerProfiles.userId, user.userId))
        .limit(1);

      const nextStatsJson = JSON.parse(JSON.stringify(parsed));

      if (existing[0]) {
        await db
          .update(playerProfiles)
          .set({
            username: user.username,
            longTermStats: nextStatsJson,
            updatedAt: new Date(),
          })
          .where(eq(playerProfiles.userId, user.userId));
      } else {
        await db.insert(playerProfiles).values({
          userId: user.userId,
          username: user.username,
          longTermStats: nextStatsJson,
        });
      }

      updated += 1;
    }
  } finally {
    redis.disconnect();
  }

  console.log(JSON.stringify({ scanned, updated, skipped }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});