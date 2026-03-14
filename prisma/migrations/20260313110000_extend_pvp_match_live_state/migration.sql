-- Extend pvp_match with DB-authoritative live lifecycle state.
ALTER TABLE "pvp_match"
ADD COLUMN "liveState" JSONB,
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "instanceId" TEXT;

-- Query support for lifecycle ownership/sweeps.
CREATE INDEX "pvp_match_status_instance_updated_idx"
ON "pvp_match"("status", "instanceId", "updatedAt");

CREATE INDEX "pvp_match_instance_updated_idx"
ON "pvp_match"("instanceId", "updatedAt");

-- Supports participant-oriented lookups in live state snapshots.
CREATE INDEX "pvp_match_live_state_participants_gin_idx"
ON "pvp_match"
USING GIN (("liveState" -> 'participants'));
