/* eslint-disable no-console */

import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { estimateInitialRatingFromLongTermStats } from "../src/features/ranking/rating";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const onlyNullUpdatedAt = process.argv.includes("--only-null-updated-at");

  const profilesResult = await db.execute<{
    userId: string;
    username: string;
    ratingUpdatedAt: Date | null;
    longTermStats: unknown;
  }>(sql`
    SELECT "userId", "username", "ratingUpdatedAt", "longTermStats"
    FROM "PlayerProfile"
  `);

  const profiles = (profilesResult.rows ?? []) as Array<{
    userId: string;
    username: string;
    ratingUpdatedAt: Date | null;
    longTermStats: unknown;
  }>;

  let updated = 0;

  for (const p of profiles) {
    if (onlyNullUpdatedAt && p.ratingUpdatedAt) continue;

    const stats = (p.longTermStats ?? {}) as any;

    const { rating, deviation } = estimateInitialRatingFromLongTermStats({
      averageWPM: stats.averageWPM,
      averageAccuracy: stats.averageAccuracy,
      averageConsistency: stats.averageConsistency,
      totalTimeTypedSec: stats.totalTimeTyped,
    });

    if (dryRun) {
      console.log(`[DRY] ${p.username}: -> rating=${rating} dev=${deviation}`);
      continue;
    }

    await db.execute(sql`
      UPDATE "PlayerProfile"
      SET
        "rating" = ${rating},
        "ratingDeviation" = ${deviation},
        "ratingUpdatedAt" = NOW(),
        "updatedAt" = NOW()
      WHERE "userId" = ${p.userId}
    `);

    updated += 1;
  }

  console.log(`Backfill complete. Updated ${updated} profiles.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
