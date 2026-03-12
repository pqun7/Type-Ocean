ALTER TABLE "User"
ADD COLUMN "isPrimaryAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "rating" INTEGER,
  "imageUrl" TEXT,
  "adminReplyTitle" TEXT,
  "adminReplyBody" TEXT,
  "respondedByUserId" TEXT,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserFeedback_status_createdAt_idx" ON "UserFeedback"("status", "createdAt");
CREATE INDEX "UserFeedback_category_createdAt_idx" ON "UserFeedback"("category", "createdAt");
CREATE INDEX "UserFeedback_userId_createdAt_idx" ON "UserFeedback"("userId", "createdAt");

ALTER TABLE "UserFeedback"
ADD CONSTRAINT "UserFeedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserFeedback"
ADD CONSTRAINT "UserFeedback_respondedByUserId_fkey"
FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;