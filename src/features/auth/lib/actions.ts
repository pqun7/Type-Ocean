// src/features/auth/lib/actions.ts
"use server";

import { signUpSchema } from "@/schemas/authSchema";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { pendingSignups, playerProfiles, users } from "@/db/schema";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import { ZodError } from "zod";
import { mapErrorToMessage } from "@/constants/errors"; 
import { logging } from '@/log/ServerLogger'; 
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limiter";
import { normalizeUsernameForStorage } from "@/features/auth/utils/username";
import { isDatabaseTemporarilyUnavailableError } from "@/lib/db-error-utils";

// Safe logging utilities for auth operations
const logAuthOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Auth operation started: ${operation}`, metadata || {});
  },
  
  success: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Auth operation completed: ${operation}`, metadata || {});
  },
  
  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Auth operation failed: ${operation}`, error, metadata);
  }
};

export const signUp = async (formData: FormData) => {
  const requestId = `signup-${Date.now()}`;
  
  try {
    logAuthOperation.start("user_signup", { requestId });

    const rawData = {
      email: formData.get("email"),
      username: formData.get("username"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    };

    // Safe debug logging for form data
    logging.debugSensitive("Validating signup form data", {
      requestId,
      email: rawData.email,
      username: rawData.username
    });

    const validatedData = signUpSchema.parse(rawData);
    logging.info("Form data validated successfully", { requestId });

    // Check for existing user
    logging.debugSensitive("Checking for existing user", {
      requestId,
      email: validatedData.email,
      username: validatedData.username
    });

    const existingUserRows = await db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(
        or(
          eq(users.email, validatedData.email.toLowerCase()),
          eq(users.username, normalizeUsernameForStorage(validatedData.username)),
        ),
      )
      .limit(1);

    const existingUser = existingUserRows[0] ?? null;

    if (existingUser) {
      const conflictField = existingUser.email === validatedData.email.toLowerCase() 
        ? "email" 
        : "username";
      
      logAuthOperation.error("user_signup", new Error("User conflict detected"), {
        requestId,
        conflictField,
        existingUserId: existingUser.id
      });
      
      return {
        success: false,
        error: "Conflict",
        details: {
          fieldErrors: {
            [conflictField]: [`This ${conflictField} is already taken.`],
          },
        },
      };
    }

    const normalizedEmail = validatedData.email.toLowerCase();
    const normalizedUsername = normalizeUsernameForStorage(validatedData.username);

    // Rate limit signup email sending.
    const headersInstance = await headers();
    const ip = headersInstance.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
    const { allowed } = await checkRateLimit("/api/auth/signup", ip);
    if (!allowed) {
      return { success: false, error: mapErrorToMessage("TOO_MANY_REQUESTS") };
    }

    // Create the user immediately (unverified). Verification email is sent only from Profile.
    logging.debug("Hashing password", { requestId });
    const hashedPassword = await saltAndHashPassword(validatedData.password);

    await db.transaction(async (tx) => {
      const createdRows = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          username: normalizedUsername,
          passwordHash: hashedPassword,
          emailVerified: null,
          emailVerifyToken: null,
          emailVerifyTokenExpiry: null,
          emailVerificationAttempts: 0,
        })
        .returning({ id: users.id, username: users.username });

      const user = createdRows[0]!;

      await tx.insert(playerProfiles).values({
        userId: user.id,
        username: user.username,
        level: 1,
        xp: 0,
        achievements: [],
        avatar: null,
      });

      await tx
        .delete(pendingSignups)
        .where(or(eq(pendingSignups.email, normalizedEmail), eq(pendingSignups.username, normalizedUsername)));
    });

    logAuthOperation.success("user_signup", {
      requestId,
      status: "user_created_unverified",
    });

    // Production-safe logging
    logging.info("Sign-up process completed successfully", {
      requestId,
      status: "pending_signup"
    });

    return { success: true };
  } catch (error) {
    // Handle validation errors
    if (error instanceof ZodError) {
      logAuthOperation.error("user_signup", error, {
        requestId,
        errorType: "validation_error",
        issues: error.issues
      });
      
      return { 
        success: false, 
        error: "Validation failed",
        details: error.flatten()
      };
    }

    // Log unexpected errors
    logAuthOperation.error("user_signup", error, {
      requestId,
      errorType: "unexpected_error"
    });

    if (isDatabaseTemporarilyUnavailableError(error)) {
      return {
        success: false,
        error: "DATABASE_UNAVAILABLE",
      };
    }
    
    return {
      success: false,
      error: "Registration failed. Please try again later.",
    };
  }
};