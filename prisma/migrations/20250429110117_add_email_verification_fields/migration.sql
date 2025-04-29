/*
  Warnings:

  - A unique constraint covering the columns `[emailVerifyToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationAttempts" INTEGER DEFAULT 0,
ADD COLUMN     "emailVerifyToken" TEXT,
ADD COLUMN     "emailVerifyTokenExpiry" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerifyToken_key" ON "User"("emailVerifyToken");
