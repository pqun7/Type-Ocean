ALTER TABLE "pvp_room"
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "autoStartAt" TIMESTAMP(3);

CREATE INDEX "pvp_room_visibility_status_createdAt_idx" ON "pvp_room"("visibility", "status", "createdAt");
