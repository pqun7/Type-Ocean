"use server";

import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { createHash, timingSafeEqual } from "crypto";
import { redirect } from "next/navigation";
import { logging } from "@/log/ServerLogger";

const OTP_TTL_MINUTES = 10;
const MAX_FAILED_ATTEMPTS = 5;

function otpHash(userId: string, otp: string): string {
  const pepper = process.env.EMAIL_OTP_PEPPER?.trim() || "";
  return createHash("sha256").update(`${userId}:${otp}:${pepper}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export async function verifyEmailOtp(prevState: { success: boolean; error: string | null }, formData: FormData) {
  const requestId = `email-otp-verify-${Date.now()}`;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const code = String(formData.get("code") || "").trim();
    const redirectParam = String(formData.get("redirect") ?? "true").trim().toLowerCase();
    const shouldRedirect = !(redirectParam === "false" || redirectParam === "0" || redirectParam === "no");
    if (!/^\d{6}$/.test(code)) {
      return { success: false, error: "INVALID_CODE" };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        emailVerified: true,
        emailVerifyOtpHash: true,
        emailVerifyOtpExpiry: true,
        emailVerifyOtpFailedAttempts: true,
      },
    });

    if (!user) return { success: false, error: "USER_NOT_FOUND" };

    const expiry = user.emailVerifyOtpExpiry;
    if (!user.emailVerifyOtpHash || !expiry) {
      return { success: false, error: "NO_ACTIVE_OTP" };
    }

    if (expiry.getTime() <= Date.now()) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          // Cancel any in-progress email change.
          pendingEmail: null,
          pendingEmailRequestedAt: null,

          // Clear OTP state.
          emailVerifyOtpHash: null,
          emailVerifyOtpExpiry: null,
          emailVerifyOtpSentAt: null,
          emailVerifyOtpFailedAttempts: 0,
        },
      });

      return { success: false, error: "OTP_EXPIRED" };
    }

    const hashed = otpHash(user.id, code);
    const ok = safeEqualHex(hashed, user.emailVerifyOtpHash);

    if (!ok) {
      const failed = (user.emailVerifyOtpFailedAttempts ?? 0) + 1;

      if (failed >= MAX_FAILED_ATTEMPTS) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            // Cancel any in-progress email change.
            pendingEmail: null,
            pendingEmailRequestedAt: null,

            // Clear OTP state.
            emailVerifyOtpHash: null,
            emailVerifyOtpExpiry: null,
            emailVerifyOtpSentAt: null,
            emailVerifyOtpFailedAttempts: 0,
          },
        });
        return { success: false, error: "TOO_MANY_ATTEMPTS" };
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifyOtpFailedAttempts: failed },
      });

      return { success: false, error: "INVALID_CODE" };
    }

    // Apply pending email (if any) and verify.
    const destinationEmail = (user.pendingEmail ?? user.email).toLowerCase().trim();

    const conflict = await prisma.user.findFirst({
      where: {
        id: { not: user.id },
        OR: [{ email: destinationEmail }, { pendingEmail: destinationEmail }],
      },
      select: { id: true },
    });

    if (conflict) {
      return { success: false, error: "EMAIL_ALREADY_IN_USE" };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: destinationEmail,
        pendingEmail: null,
        pendingEmailRequestedAt: null,
        emailVerified: new Date(),
        emailVerifyOtpHash: null,
        emailVerifyOtpExpiry: null,
        emailVerifyOtpSentAt: null,
        emailVerifyOtpFailedAttempts: 0,

        // Clear legacy link-token fields if present.
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null,
        emailVerificationAttempts: 0,
      },
    });

    logging.info("Email verified via OTP", { requestId, userId: user.id });

    // Same redirect convention as token verification.
    if (shouldRedirect) {
      redirect("/auth?verified=success");
    }

    return { success: true, error: null };
  } catch (err) {
    logging.error("verifyEmailOtp failed", err, { requestId });
    return { success: false, error: "SERVER_ERROR" };
  }
}
