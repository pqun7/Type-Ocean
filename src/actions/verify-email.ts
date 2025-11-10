// src/actions/verify-email.ts
"use server";

import { prisma } from "@/features/auth/lib/db";
import { validateEmailToken } from "@/features/auth/utils/tokens";
import { redirect } from "next/navigation";
import { logging } from "@/log/ServerLogger";

// Safe logging utilities for email verification
const logVerificationOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email verification started: ${operation}`, metadata || {});
  },
  
  success: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email verification completed: ${operation}`, metadata || {});
  },
  
  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Email verification failed: ${operation}`, error, metadata);
  }
};

export async function verifyEmail(token: string) {
  const requestId = `verify-email-${Date.now()}`;
  
  try {
    logVerificationOperation.start("verify_email", {
      requestId,
      hasToken: !!token
    });

    const user = await validateEmailToken(token);
    
    // Safe debug logging
    logging.debugSensitive("Email verification attempt", {
      requestId,
      userId: user.id,
      email: user.email,
      alreadyVerified: !!user.emailVerified
    });

    if (user.emailVerified) {
      logVerificationOperation.error("verify_email", new Error("Email already verified"), {
        requestId,
        userId: user.id
      });
      redirect(`/auth?error=EMAIL_ALREADY_VERIFIED`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null,
        emailVerificationAttempts: 0
      }
    });

    logVerificationOperation.success("verify_email", {
      requestId,
      userId: user.id,
      status: "email_verified_successfully"
    });

    // Production-safe logging
    logging.info("Email verified successfully", {
      requestId,
      userId: user.id
    });

    redirect("/home?verified=success");
  } catch (error) {
    logVerificationOperation.error("verify_email", error, {
      requestId,
      tokenProvided: !!token
    });
    
    // Production-safe error logging
    logging.error("Email verification failed", error, {
      requestId,
      errorType: "invalid_verification_token"
    });
    
    redirect("/auth?error=INVALID_VERIFICATION_TOKEN");
  }
}