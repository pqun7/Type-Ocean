ALTER TABLE "User"
ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

ALTER TABLE "pvp_match"
ADD COLUMN "textId" TEXT,
ADD COLUMN "inputNonce" TEXT;

CREATE TABLE "cheat_flag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "flags" TEXT[],
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "wouldSanction" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheat_flag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cheat_flag_userId_matchId_key" ON "cheat_flag"("userId", "matchId");
CREATE INDEX "cheat_flag_userId_createdAt_idx" ON "cheat_flag"("userId", "createdAt");
CREATE INDEX "cheat_flag_reviewed_createdAt_idx" ON "cheat_flag"("reviewed", "createdAt");

ALTER TABLE "cheat_flag"
ADD CONSTRAINT "cheat_flag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cheat_flag"
ADD CONSTRAINT "cheat_flag_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "pvp_match"("id") ON DELETE CASCADE ON UPDATE CASCADE;