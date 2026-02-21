/* eslint-disable no-console */

import prisma from "../src/features/auth/lib/db";
import { estimateInitialRatingFromLongTermStats } from "../src/features/ranking/rating";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const onlyNullUpdatedAt = process.argv.includes("--only-null-updated-at");

  const profiles = await prisma.playerProfile.findMany({
    select: {
      userId: true,
      username: true,
      ratingUpdatedAt: true,
      longTermStats: true,
    },
  });

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

    await prisma.playerProfile.update({
      where: { userId: p.userId },
      data: {
        rating,
        ratingDeviation: deviation,
        ratingUpdatedAt: new Date(),
      },
    });

    updated += 1;
  }

  console.log(`Backfill complete. Updated ${updated} profiles.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
