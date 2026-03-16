"use server";

import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationEmail } from "@/features/auth/providers/nodemailer";
import { mapErrorToMessage } from "@/constants/errors";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pendingSignups, users } from "@/db/schema";
import { logging } from "@/log/ServerLogger";
import { createHash, randomBytes } from "crypto";

// Safe logging utilities for email verification
const logEmailVerificationOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email verification operation started: ${operation}`, metadata || {});
  },
  
  success: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email verification operation completed: ${operation}`, metadata || {});
  },
  
  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Email verification operation failed: ${operation}`, error, metadata);
  }
};

export async function resendVerificationEmail(email: string) {
  const requestId = `resend-verification-${Date.now()}`;
  const headersInstance = await headers();
  const ip = headersInstance.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const endpoint = "/api/auth/resend-verification";

  try {
    logEmailVerificationOperation.start("resend_verification_email", {
      requestId,
      email,
      ip,
      endpoint
    });

    const normalizedEmail = email.toLowerCase();

    // Check if this email is already a verified user.
    const userRows = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    const user = userRows[0] ?? null;

    if (user?.emailVerified) {
      logEmailVerificationOperation.error(
        "resend_verification_email",
        new Error("Email already verified"),
        {
          requestId,
          userId: user.id,
          email: normalizedEmail,
        }
      );
      return { error: "EMAIL_ALREADY_VERIFIED" };
    }

    const { allowed } = await checkRateLimit(endpoint, ip);
    if (!allowed) {
      logEmailVerificationOperation.error("resend_verification_email", new Error("Rate limit exceeded"), {
        requestId,
        email,
        ip,
        endpoint
      });
      return { error: "TOO_MANY_REQUESTS" };
    }

    const rawToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(rawToken).digest("hex");
    const tokenExpiry = new Date(Date.now() + 24 * 3600 * 1000);

    // Update token either on an existing unverified user, or on a PendingSignup.
    if (user?.id) {
      await db
        .update(users)
        .set({
          emailVerifyToken: hashedToken,
          emailVerifyTokenExpiry: tokenExpiry,
          emailVerificationAttempts: sql`${users.emailVerificationAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    } else {
      const pendingRows = await db
        .select({ id: pendingSignups.id })
        .from(pendingSignups)
        .where(eq(pendingSignups.email, normalizedEmail))
        .limit(1);

      const pending = pendingRows[0] ?? null;

      if (!pending) {
        return { error: "USER_NOT_FOUND" };
      }

      await db
        .update(pendingSignups)
        .set({
          emailVerifyToken: hashedToken,
          emailVerifyTokenExpiry: tokenExpiry,
          emailVerificationAttempts: sql`${pendingSignups.emailVerificationAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(pendingSignups.id, pending.id));
    }

    const { success, error } = await sendVerificationEmail(normalizedEmail, rawToken);

    if (success) {
      logEmailVerificationOperation.success("resend_verification_email", {
        requestId,
        userId: user?.id,
        email,
        status: "verification_email_sent"
      });

      // Production-safe logging
      logging.info("Verification email sent successfully", {
        requestId,
        userId: user?.id
      });

      return { success: true };
    } else {
      logEmailVerificationOperation.error("resend_verification_email", new Error("Failed to send email"), {
        requestId,
        userId: user?.id,
        email,
        internalError: error
      });
      return { error: mapErrorToMessage(error || "FAILED_TO_SEND_EMAIL") };
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    logEmailVerificationOperation.error("resend_verification_email", error, {
      requestId,
      email,
      ip,
      endpoint
    });
    return { error: mapErrorToMessage(errorMessage) };
  }
}