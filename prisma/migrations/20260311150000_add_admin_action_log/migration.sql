CREATE TABLE "AdminActionLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminActionLog_actorUserId_createdAt_idx" ON "AdminActionLog"("actorUserId", "createdAt");
CREATE INDEX "AdminActionLog_targetUserId_createdAt_idx" ON "AdminActionLog"("targetUserId", "createdAt");
CREATE INDEX "AdminActionLog_entityType_createdAt_idx" ON "AdminActionLog"("entityType", "createdAt");

ALTER TABLE "AdminActionLog"
ADD CONSTRAINT "AdminActionLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminActionLog"
ADD CONSTRAINT "AdminActionLog_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;