"use server";

import { auth } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";
import { createHash, randomInt } from "crypto";
import { sendVerificationOtpEmail } from "@/features/auth/providers/nodemailer";

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

function now(): Date {
  return new Date();
}

function generateOtp(): string {
  const n = randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LENGTH, "0");
}

function otpHash(userId: string, otp: string): string {
  const pepper = process.env.EMAIL_OTP_PEPPER?.trim() || "";
  return createHash("sha256").update(`${userId}:${otp}:${pepper}`).digest("hex");
}

export async function requestEmailVerificationOtp(): Promise<
  | { success: true; sentAt: string }
  | { success: false; error: "OTP_COOLDOWN"; retryAfterSeconds: number }
  | { success: false; error: string }
> {
  const requestId = `email-otp-request-${Date.now()}`;

  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: "NOT_AUTHENTICATED" };

    const headersInstance = await headers();
    const ip = headersInstance.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";

    const { allowed } = await checkRateLimit("/api/auth/email-otp/request", ip);
    if (!allowed) return { success: false, error: "TOO_MANY_REQUESTS" };

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        pendingEmail: users.pendingEmail,
        emailVerified: users.emailVerified,
        emailVerifyOtpSentAt: users.emailVerifyOtpSentAt,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    const user = userRows[0] ?? null;

    if (!user) return { success: false, error: "USER_NOT_FOUND" };

    const destination = (user.pendingEmail ?? user.email).toLowerCase().trim();

    if (user.emailVerifyOtpSentAt) {
      const cooldownMs = RESEND_COOLDOWN_SECONDS * 1000;
      const elapsed = Date.now() - user.emailVerifyOtpSentAt.getTime();
      if (elapsed < cooldownMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
        return { success: false, error: "OTP_COOLDOWN", retryAfterSeconds };
      }
    }

    const otp = generateOtp();
    const hashed = otpHash(user.id, otp);
    const expiry = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    const sentAt = now();

    await db
      .update(users)
      .set({
        emailVerifyOtpHash: hashed,
        emailVerifyOtpExpiry: expiry,
        emailVerifyOtpSentAt: sentAt,
        emailVerifyOtpFailedAttempts: 0,
        emailVerificationAttempts: sql`${users.emailVerificationAttempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const { success, error } = await sendVerificationOtpEmail(destination, otp, OTP_TTL_MINUTES);
    if (!success) {
      logging.error("Failed to send OTP email", new Error(error || "EMAIL_SEND_FAILED"), {
        requestId,
        userId: user.id,
      });
      return { success: false, error: error || "EMAIL_SEND_FAILED" };
    }

    logging.info("Verification OTP sent", { requestId, userId: user.id });
    return { success: true, sentAt: sentAt.toISOString() };
  } catch (err) {
    logging.error("requestEmailVerificationOtp failed", err, { requestId });
    return { success: false, error: "SERVER_ERROR" };
  }
}

