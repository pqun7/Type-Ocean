-- DropIndex
DROP INDEX "Session_sessionToken_key";

-- CreateTable
CREATE TABLE "daily_typing_activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "totalTimeSpentSec" INTEGER NOT NULL DEFAULT 0,
    "sumWpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sumAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_typing_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_typing_activity_userId_localDate_idx" ON "daily_typing_activity"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_typing_activity_userId_localDate_key" ON "daily_typing_activity"("userId", "localDate");

-- AddForeignKey
ALTER TABLE "daily_typing_activity" ADD CONSTRAINT "daily_typing_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
