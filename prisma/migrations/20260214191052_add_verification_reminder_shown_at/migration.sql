-- AlterTable
ALTER TABLE "User" ADD COLUMN     "verificationReminderShownAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pending_signup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifyToken" TEXT NOT NULL,
    "emailVerifyTokenExpiry" TIMESTAMP(3) NOT NULL,
    "emailVerificationAttempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_signup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_signup_email_key" ON "pending_signup"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pending_signup_username_key" ON "pending_signup"("username");

-- CreateIndex
CREATE UNIQUE INDEX "pending_signup_emailVerifyToken_key" ON "pending_signup"("emailVerifyToken");
