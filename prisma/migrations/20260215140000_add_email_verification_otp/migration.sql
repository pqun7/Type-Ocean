-- Add OTP-based email verification fields to User
ALTER TABLE "User"
ADD COLUMN     "emailVerifyOtpHash" TEXT,
ADD COLUMN     "emailVerifyOtpExpiry" TIMESTAMP(3),
ADD COLUMN     "emailVerifyOtpSentAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifyOtpFailedAttempts" INTEGER NOT NULL DEFAULT 0;
