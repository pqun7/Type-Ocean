-- CreateTable
CREATE TABLE "pvp_room" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "minPlayers" INTEGER NOT NULL DEFAULT 2,
    "maxPlayers" INTEGER NOT NULL DEFAULT 6,
    "textSnapshot" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pvp_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_room_member" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "colorSlot" INTEGER NOT NULL,
    "readyAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "pvp_room_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_match" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "roomId" TEXT,
    "textSnapshot" TEXT NOT NULL,
    "serverStartAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pvp_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_participant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "finalWpm" INTEGER,
    "finalAccuracy" DOUBLE PRECISION,
    "finalErrors" INTEGER,
    "timeSpentSec" INTEGER,
    "completedAt" TIMESTAMP(3),
    "disconnectCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pvp_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_event" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pvp_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_rating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1500,
    "deviation" INTEGER NOT NULL DEFAULT 350,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pvp_rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_rating_change" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "beforeRating" INTEGER NOT NULL,
    "afterRating" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pvp_rating_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pvp_room_code_key" ON "pvp_room"("code");

-- CreateIndex
CREATE INDEX "pvp_room_status_createdAt_idx" ON "pvp_room"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pvp_room_member_roomId_idx" ON "pvp_room_member"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_room_member_roomId_userId_key" ON "pvp_room_member"("roomId", "userId");

-- CreateIndex
CREATE INDEX "pvp_match_status_createdAt_idx" ON "pvp_match"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pvp_participant_matchId_idx" ON "pvp_participant"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_participant_matchId_userId_key" ON "pvp_participant"("matchId", "userId");

-- CreateIndex
CREATE INDEX "pvp_event_matchId_createdAt_idx" ON "pvp_event"("matchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_event_matchId_seq_key" ON "pvp_event"("matchId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_rating_userId_key" ON "pvp_rating"("userId");

-- CreateIndex
CREATE INDEX "pvp_rating_rating_idx" ON "pvp_rating"("rating");

-- CreateIndex
CREATE INDEX "pvp_rating_change_userId_createdAt_idx" ON "pvp_rating_change"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_rating_change_matchId_userId_key" ON "pvp_rating_change"("matchId", "userId");

-- AddForeignKey
ALTER TABLE "pvp_room" ADD CONSTRAINT "pvp_room_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_room_member" ADD CONSTRAINT "pvp_room_member_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "pvp_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_room_member" ADD CONSTRAINT "pvp_room_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_match" ADD CONSTRAINT "pvp_match_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "pvp_room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_participant" ADD CONSTRAINT "pvp_participant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "pvp_match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_participant" ADD CONSTRAINT "pvp_participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_event" ADD CONSTRAINT "pvp_event_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "pvp_match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_rating" ADD CONSTRAINT "pvp_rating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_rating_change" ADD CONSTRAINT "pvp_rating_change_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "pvp_match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_rating_change" ADD CONSTRAINT "pvp_rating_change_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
