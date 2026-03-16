// src/actions/verify-email.ts
"use server";

import { and, eq, gt, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { pendingSignups, playerProfiles, users } from "@/db/schema";
import { ensurePlayerProfile } from "@/features/auth/server/player-profile";
import { redirect } from "next/navigation";
import { logging } from "@/log/ServerLogger";
import { createHash } from "crypto";

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
    const pendingRows = await db
      .select()
      .from(pendingSignups)
      .where(
        and(
          eq(pendingSignups.emailVerifyToken, hashedToken),
          gt(pendingSignups.emailVerifyTokenExpiry, new Date()),
        ),
      )
      .limit(1);

    const pending = pendingRows[0] ?? null;

    if (pending) {
      const created = await db.transaction(async (tx) => {
        const createdUsers = await tx
          .insert(users)
          .values({
            email: pending.email,
            username: pending.username,
            passwordHash: pending.passwordHash,
            emailVerified: new Date(),
            emailVerifyToken: null,
            emailVerifyTokenExpiry: null,
            emailVerificationAttempts: 0,
          })
          .returning({ id: users.id, username: users.username });

        const user = createdUsers[0]!;

        await tx.insert(playerProfiles).values({
          userId: user.id,
          username: user.username,
          level: 1,
          xp: 0,
          achievements: [],
          avatar: null,
        });

        await tx.delete(pendingSignups).where(eq(pendingSignups.id, pending.id));

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
    const userRows = await db
      .select()
      .from(users)
      .where(and(eq(users.emailVerifyToken, hashedToken), gt(users.emailVerifyTokenExpiry, new Date())))
      .limit(1);

    const user = userRows[0] ?? null;

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

      const conflictRows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            ne(users.id, user.id),
            or(eq(users.email, normalizedPending), eq(users.pendingEmail, normalizedPending)),
          ),
        )
        .limit(1);

      const conflict = conflictRows[0] ?? null;

      if (conflict) {
        redirect("/auth?error=EMAIL_ALREADY_IN_USE");
      }

      await db
        .update(users)
        .set({
          email: normalizedPending,
          pendingEmail: null,
          pendingEmailRequestedAt: null,
          emailVerified: new Date(),
          emailVerifyToken: null,
          emailVerifyTokenExpiry: null,
          emailVerificationAttempts: 0,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

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

    await db
      .update(users)
      .set({
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null,
        emailVerificationAttempts: 0,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Ensure PlayerProfile exists.
    try {
      await ensurePlayerProfile({
        userId: user.id,
        username: user.username,
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