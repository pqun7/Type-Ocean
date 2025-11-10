"use server";

import { headers } from "next/headers";
import { generateEmailVerificationToken } from "@/features/auth/utils/tokens";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationEmail } from "@/features/auth/providers/resend";
import { mapErrorToMessage } from "@/constants/errors";
import prisma from "@/features/auth/lib/db";
import { logging } from "@/log/ServerLogger";

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

    // التحقق من حالة البريد مسبقًا
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    });

    if (user?.emailVerified) {
      logEmailVerificationOperation.error("resend_verification_email", new Error("Email already verified"), {
        requestId,
        userId: user.id,
        email
      });
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

    const token = await generateEmailVerificationToken(email);
    const { success, error } = await sendVerificationEmail(email, token);

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