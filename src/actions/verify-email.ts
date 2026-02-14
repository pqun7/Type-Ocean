// src/actions/verify-email.ts
"use server";

import { prisma } from "@/features/auth/lib/db";
import { redirect } from "next/navigation";
import { logging } from "@/log/ServerLogger";
import { createHash } from "crypto";

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

    const hashedToken = createHash("sha256").update(token).digest("hex");

    // 1) Pending signup verification: create the user only after email verification.
    const pending = await prisma.pendingSignup.findFirst({
      where: {
        emailVerifyToken: hashedToken,
        emailVerifyTokenExpiry: { gt: new Date() },
      },
    });

    if (pending) {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: pending.email,
            username: pending.username,
            passwordHash: pending.passwordHash,
            emailVerified: new Date(),
            emailVerifyToken: null,
            emailVerifyTokenExpiry: null,
            emailVerificationAttempts: 0,
          },
        });

        await tx.playerProfile.create({
          data: {
            userId: user.id,
            username: user.username,
            level: 1,
            xp: 0,
            achievements: [],
            avatar: null,
          },
        });

        await tx.pendingSignup.delete({ where: { id: pending.id } });

        return user;
      });

      logVerificationOperation.success("verify_email", {
        requestId,
        userId: created.id,
        status: "pending_signup_verified_and_user_created",
      });

      redirect("/home?verified=success");
    }

    // 2) Existing user verification
    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: hashedToken,
        emailVerifyTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw new Error("INVALID_OR_EXPIRED_TOKEN");
    }
    
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

    // Ensure PlayerProfile exists.
    try {
      await prisma.playerProfile.create({
        data: {
          userId: user.id,
          username: user.username,
          level: 1,
          xp: 0,
          achievements: [],
          avatar: null,
        },
      });
    } catch {
      // Ignore duplicates / race conditions
    }

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