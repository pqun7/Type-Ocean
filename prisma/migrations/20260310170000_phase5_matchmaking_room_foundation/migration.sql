ALTER TABLE "pvp_room"
ADD COLUMN "hostUserId" TEXT;

UPDATE "pvp_room"
SET "hostUserId" = "createdByUserId"
WHERE "hostUserId" IS NULL;

ALTER TABLE "pvp_room"
ALTER COLUMN "hostUserId" SET NOT NULL;

ALTER TABLE "pvp_room"
ADD CONSTRAINT "pvp_room_hostUserId_fkey"
FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "pvp_room_hostUserId_idx" ON "pvp_room"("hostUserId");

CREATE TABLE "pvp_matchmaking_preference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "preferredMode" TEXT NOT NULL DEFAULT 'ranked_1v1',
  "textDifficulty" TEXT NOT NULL DEFAULT 'normal',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pvp_matchmaking_preference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pvp_matchmaking_preference_userId_key" ON "pvp_matchmaking_preference"("userId");

ALTER TABLE "pvp_matchmaking_preference"
ADD CONSTRAINT "pvp_matchmaking_preference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;