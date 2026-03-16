"use server";

import { auth } from "@/lib/auth";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
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

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        pendingEmail: users.pendingEmail,
        emailVerified: users.emailVerified,
        emailVerifyOtpHash: users.emailVerifyOtpHash,
        emailVerifyOtpExpiry: users.emailVerifyOtpExpiry,
        emailVerifyOtpFailedAttempts: users.emailVerifyOtpFailedAttempts,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    const user = userRows[0] ?? null;

    if (!user) return { success: false, error: "USER_NOT_FOUND" };

    const expiry = user.emailVerifyOtpExpiry;
    if (!user.emailVerifyOtpHash || !expiry) {
      return { success: false, error: "NO_ACTIVE_OTP" };
    }

    if (expiry.getTime() <= Date.now()) {
      await db
        .update(users)
        .set({
          pendingEmail: null,
          pendingEmailRequestedAt: null,
          emailVerifyOtpHash: null,
          emailVerifyOtpExpiry: null,
          emailVerifyOtpSentAt: null,
          emailVerifyOtpFailedAttempts: 0,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return { success: false, error: "OTP_EXPIRED" };
    }

    const hashed = otpHash(user.id, code);
    const ok = safeEqualHex(hashed, user.emailVerifyOtpHash);

    if (!ok) {
      const failed = (user.emailVerifyOtpFailedAttempts ?? 0) + 1;

      if (failed >= MAX_FAILED_ATTEMPTS) {
        await db
          .update(users)
          .set({
            pendingEmail: null,
            pendingEmailRequestedAt: null,
            emailVerifyOtpHash: null,
            emailVerifyOtpExpiry: null,
            emailVerifyOtpSentAt: null,
            emailVerifyOtpFailedAttempts: 0,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        return { success: false, error: "TOO_MANY_ATTEMPTS" };
      }

      await db
        .update(users)
        .set({ emailVerifyOtpFailedAttempts: failed, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return { success: false, error: "INVALID_CODE" };
    }

    // Apply pending email (if any) and verify.
    const destinationEmail = (user.pendingEmail ?? user.email).toLowerCase().trim();

    const conflictRows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          ne(users.id, user.id),
          or(eq(users.email, destinationEmail), eq(users.pendingEmail, destinationEmail)),
        ),
      )
      .limit(1);

    const conflict = conflictRows[0] ?? null;

    if (conflict) {
      return { success: false, error: "EMAIL_ALREADY_IN_USE" };
    }

    await db
      .update(users)
      .set({
        email: destinationEmail,
        pendingEmail: null,
        pendingEmailRequestedAt: null,
        emailVerified: new Date(),
        emailVerifyOtpHash: null,
        emailVerifyOtpExpiry: null,
        emailVerifyOtpSentAt: null,
        emailVerifyOtpFailedAttempts: 0,
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null,
        emailVerificationAttempts: 0,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

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

