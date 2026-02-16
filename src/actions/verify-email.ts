// src/actions/verify-email.ts
"use server";

import { prisma } from "@/features/auth/lib/db";
import { redirect } from "next/navigation";
import { logging } from "@/log/ServerLogger";
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybe = error as { digest?: unknown };
  return typeof maybe.digest === "string" && maybe.digest.startsWith("NEXT_REDIRECT");
}

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
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

      // NOTE: We intentionally redirect with query params.
      // The middleware will convert them into short-lived flash cookies
      // and immediately redirect to a clean URL (no params in the address bar).
      redirect("/auth?verified=success");
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

    // If this token was issued for an email change request, apply it now.
    const pendingEmail = (user as unknown as { pendingEmail?: string | null }).pendingEmail ?? null;

    if (pendingEmail) {
      const normalizedPending = pendingEmail.toLowerCase().trim();

      const conflict = await prisma.user.findFirst({
        where: {
          id: { not: user.id },
          OR: [{ email: normalizedPending }, { pendingEmail: normalizedPending }],
        },
        select: { id: true },
      });

      if (conflict) {
        redirect("/auth?error=EMAIL_ALREADY_IN_USE");
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          email: normalizedPending,
          pendingEmail: null,
          pendingEmailRequestedAt: null,
          emailVerified: new Date(),
          emailVerifyToken: null,
          emailVerifyTokenExpiry: null,
          emailVerificationAttempts: 0,
        },
      });

      logVerificationOperation.success("verify_email", {
        requestId,
        userId: user.id,
        status: "pending_email_applied_and_verified",
      });

      redirect("/auth?verified=success");
    }

    if (user.emailVerified) {
      logVerificationOperation.error("verify_email", new Error("Email already verified"), {
        requestId,
        userId: user.id
      });
      redirect("/auth?verified=already");
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

    redirect("/auth?verified=success");
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    logVerificationOperation.error("verify_email", error, {
      requestId,
      tokenProvided: !!token
    });
    
    // Production-safe error logging
    logging.error("Email verification failed", error, {
      requestId,
      errorType: "invalid_verification_token"
    });

    redirect("/auth?error=INVALID_OR_EXPIRED_TOKEN");
  }
}