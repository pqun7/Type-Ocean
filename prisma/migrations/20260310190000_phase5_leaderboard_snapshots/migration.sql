CREATE TABLE "leaderboard_snapshot" (
  "id" TEXT NOT NULL,
  "snapshotKey" TEXT NOT NULL DEFAULT 'global',
  "userId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "username" TEXT NOT NULL,
  "avatar" TEXT,
  "rating" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "leaderboard_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leaderboard_snapshot_snapshotKey_userId_key"
ON "leaderboard_snapshot"("snapshotKey", "userId");

CREATE UNIQUE INDEX "leaderboard_snapshot_snapshotKey_position_key"
ON "leaderboard_snapshot"("snapshotKey", "position");

CREATE INDEX "leaderboard_snapshot_snapshotKey_position_idx"
ON "leaderboard_snapshot"("snapshotKey", "position");

CREATE INDEX "leaderboard_snapshot_snapshotKey_refreshedAt_idx"
ON "leaderboard_snapshot"("snapshotKey", "refreshedAt");

CREATE TABLE "leaderboard_snapshot_meta" (
  "snapshotKey" TEXT NOT NULL,
  "refreshedAt" TIMESTAMP(3),
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "stale" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "leaderboard_snapshot_meta_pkey" PRIMARY KEY ("snapshotKey")
);