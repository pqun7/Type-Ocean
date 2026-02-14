"use server";

import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationEmail } from "@/features/auth/providers/resend";
import { mapErrorToMessage } from "@/constants/errors";
import prisma from "@/features/auth/lib/db";
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
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, emailVerified: true },
    });

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
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifyToken: hashedToken,
          emailVerifyTokenExpiry: tokenExpiry,
          emailVerificationAttempts: { increment: 1 },
        },
      });
    } else {
      const pending = await prisma.pendingSignup.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      if (!pending) {
        return { error: "USER_NOT_FOUND" };
      }

      await prisma.pendingSignup.update({
        where: { id: pending.id },
        data: {
          emailVerifyToken: hashedToken,
          emailVerifyTokenExpiry: tokenExpiry,
          emailVerificationAttempts: { increment: 1 },
        },
      });
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