-- AlterTable
ALTER TABLE "player_profile" ADD COLUMN     "rating" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "ratingDeviation" INTEGER NOT NULL DEFAULT 350,
ADD COLUMN     "ratingUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "player_profile_rating_idx" ON "player_profile"("rating");
