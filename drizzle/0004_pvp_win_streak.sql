-- Add win streak tracking columns to pvp_rating table
ALTER TABLE "pvp_rating"
  ADD COLUMN "currentStreak"    integer NOT NULL DEFAULT 0,
  ADD COLUMN "longestStreak"    integer NOT NULL DEFAULT 0,
  ADD COLUMN "lastStreakMatchId" uuid;
