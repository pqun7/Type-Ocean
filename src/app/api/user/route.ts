import { auth } from "@/features/auth/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { logging } from "@/log/ServerLogger";
import { connectIfNeeded, redis } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { rateLimiter } from "@/lib/rate-limiter"
import bcrypt from "bcryptjs";
import { normalizeUsernameForStorage } from "@/features/auth/utils/username";
import { createHash, randomInt } from "crypto";
import { sendVerificationOtpEmail } from "@/features/auth/providers/nodemailer";
import { sanitizeAvatarUrl, sanitizeDisplayName } from "@/lib/sanitize";
import { refreshLeaderboardProfileCache } from "@/features/pvp/server/leaderboard-cache";
import { ensurePlayerProfile, syncPlayerProfile } from "@/features/auth/server/player-profile";
import { clearAuthSessionCookies } from "@/features/auth/server/session-cookies";
import { isPrismaAccountHoldError } from "@/lib/prisma-error-utils";

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;


const SERVICE_TYPE = "USER-API";

type UserProfileRow = {
  id: string;
  username: string;
  email: string;
  emailVerified: Date | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  profileId: string | null;
  profileUsername: string | null;
  level: number | null;
  xp: number | null;
  achievements: unknown;
  avatar: string | null;
  hideFromLeaderboard: boolean | null;
};

type CurrentUserRow = {
  email: string;
  pendingEmail: string | null;
  username: string;
  usernameLastChangedAt: Date | null;
  passwordHash: string | null;
  emailVerified: Date | null;
  emailVerifyOtpSentAt: Date | null;
};

type UpdatedUserRow = {
  id: string;
  username: string;
  email: string;
  pendingEmail: string | null;
  emailVerified: Date | null;
  updatedAt: Date;
  usernameLastChangedAt: Date | null;
};

const usernameValidation = z
  .string()
  .trim()
  .min(3, { message: "Username must be at least 3 characters" })
  .max(20, { message: "Username cannot exceed 20 characters" })
  .regex(/^[a-zA-Z0-9_]+$/, {
    message: "Username can only contain letters, numbers, and underscores",
  });

const UpdateUserSchema = z.object({
  username: usernameValidation.optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().min(1).max(256).optional(),
  profileData: z
    .object({
      username: usernameValidation.optional(),
      avatar: z
        .union([
          z
            .string()
            .trim()
            .max(2048, "Avatar URL too long")
            .refine(
              (v) => /^https?:\/\//i.test(v),
              "Avatar URL must be http(s)"
            ),
          z.literal(""),
          z.null(),
        ])
        .optional(),
      hideFromLeaderboard: z.boolean().optional(),
    })
    .optional(),
});


// Minimal CSRF validation for unsafe methods
function validateCSRF(req: NextRequest): string | null {
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  const host = new URL(req.url).origin;

  if (origin && origin !== host) return "Invalid origin";
  if (referer && !referer.startsWith(host)) return "Invalid referer";
  return null;
}


// Safe logging utilities for user operations
const logUserOperation = {
  start: (requestId: string, operation: string, userId?: string) => {
    logging.debugSensitive(`User operation started: ${operation}`, {
      requestId,
      service: SERVICE_TYPE,
      userId,
      operation
    });
  },
  
  success: (requestId: string, operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`User operation completed: ${operation}`, {
      requestId,
      service: SERVICE_TYPE,
      ...metadata
    });
  },
  
  error: (requestId: string, operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`User operation failed: ${operation}`, error, {
      requestId,
      service: SERVICE_TYPE,
      ...metadata
    });
  }
};

/**
 * GET - Get current user profile
 */
export async function GET(req: NextRequest) {
  const requestId = uuidv4();

   const { allowed, headers } = await rateLimiter.applyRateLimit(req, "/api/user:GET");
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }


  try {
    const session = await auth();
    if (!session?.user?.id) {
      logging.warn("Unauthorized user profile access attempt", {
        requestId,
        service: SERVICE_TYPE
      });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await db.execute<UserProfileRow>(sql`
      SELECT
        u."id",
        u."username",
        u."email",
        u."emailVerified",
        u."image",
        u."createdAt",
        u."updatedAt",
        p."id" AS "profileId",
        p."username" AS "profileUsername",
        p."level",
        p."xp",
        p."achievements",
        p."avatar",
        p."hideFromLeaderboard"
      FROM "User" u
      LEFT JOIN "PlayerProfile" p ON p."userId" = u."id"
      WHERE u."id" = ${session.user.id}
      LIMIT 1
    `);

    const row = (result.rows?.[0] as UserProfileRow | undefined) ?? null;
    const user = row
      ? {
          id: row.id,
          username: row.username,
          email: row.email,
          emailVerified: row.emailVerified,
          image: row.image,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          profile: row.profileId
            ? {
                id: row.profileId,
                username: row.profileUsername ?? row.username,
                level: row.level ?? 1,
                xp: row.xp ?? 0,
                achievements: row.achievements ?? [],
                avatar: row.avatar,
                hideFromLeaderboard: row.hideFromLeaderboard ?? false,
              }
            : null,
        }
      : null;

    if (!user) {
      logging.warn("Rejecting stale authenticated profile request for deleted user", {
        requestId,
        service: SERVICE_TYPE,
        userId: session.user.id,
      });

      return clearAuthSessionCookies(
        NextResponse.json(
          { error: "Unauthorized", reason: "USER_NOT_FOUND" },
          { status: 401 }
        )
      );
    }

    logUserOperation.start(requestId, "get_user_profile", user.id);

    logUserOperation.success(requestId, "get_user_profile", {
      userId: user.id,
      hasProfile: !!user.profile,
    });

    let {profile} = user;
    if (!profile) {
      profile = await ensurePlayerProfile({
        userId: user.id,
        username: user.username,
        select: {
          id: true,
          username: true,
          level: true,
          xp: true,
          achievements: true,
          avatar: true,
          hideFromLeaderboard: true,
        },
      }) as NonNullable<typeof user.profile>;
    }

    return NextResponse.json({
      user: {
        ...user,
        profile,
      },
    });
  } catch (error) {
    if (isPrismaAccountHoldError(error)) {
      logUserOperation.error(requestId, "get_user_profile", error, {
        operationPhase: "get_user_profile",
        fallbackStatus: 503,
        reason: "prisma_account_hold",
      });

      return NextResponse.json(
        {
          error: "Profile is temporarily unavailable due to a database account hold",
          code: "DB_ACCOUNT_HOLD",
        },
        {
          status: 503,
          headers: {
            "Retry-After": "120",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    logUserOperation.error(requestId, "get_user_profile", error, {
      operationPhase: "get_user_profile",
    });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update user profile
 */
export async function PATCH(req: NextRequest) {
  const requestId = uuidv4();

  // Rate limit writes
  const rl = await rateLimiter.applyRateLimit(req, "/api/user:PATCH");
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rl.headers });
  }

  // CSRF for unsafe method
  const csrfError = validateCSRF(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      logging.warn("Unauthorized user profile update attempt", {
        requestId,
        service: SERVICE_TYPE
      });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    logUserOperation.start(requestId, "update_user_profile", session.user.id);

    const body = await req.json();
    const validationResult = UpdateUserSchema.safeParse(body);

    if (!validationResult.success) {
      logUserOperation.error(requestId, "update_user_profile", new Error("Validation failed"), {
        validationErrors: validationResult.error.issues
      });
      return NextResponse.json(
        {
          error: "Invalid input",
          details: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { username, email, profileData } = validationResult.data;

    const normalizedEmail = email ? email.trim().toLowerCase() : undefined;

    // Normalize usernames for consistency and uniqueness (align with sign-up)
    // Support legacy clients that might send profileData.username.
    const normalizedUsername = username
      ? normalizeUsernameForStorage(sanitizeDisplayName(username, 20))
      : undefined;
    const normalizedProfileUsername = profileData?.username
      ? normalizeUsernameForStorage(sanitizeDisplayName(profileData.username, 20))
      : undefined;
    const requestedUsername = normalizedUsername ?? normalizedProfileUsername;

    // Normalize avatar clearing
    const normalizedAvatar =
      profileData && "avatar" in profileData
        ? profileData.avatar === "" ? null : sanitizeAvatarUrl(profileData.avatar)
        : undefined;

    const hideFromLeaderboardPatch =
      profileData && typeof profileData.hideFromLeaderboard === "boolean"
        ? profileData.hideFromLeaderboard
        : undefined;

    // Safe debug logging for update attempt
    logging.debugSensitive("User profile update attempt", {
      requestId,
      userId: session.user.id,
      updatingFields: {
        username: !!username,
        email: !!email,
        profileData: !!profileData
      }
    });
    
    // Load current values for safe compare & policy enforcement
    const currentResult = await db.execute<CurrentUserRow>(sql`
      SELECT
        "email",
        "pendingEmail",
        "username",
        "usernameLastChangedAt",
        "passwordHash",
        "emailVerified",
        "emailVerifyOtpSentAt"
      FROM "User"
      WHERE "id" = ${session.user.id}
      LIMIT 1
    `);

    const currentUser = (currentResult.rows?.[0] as CurrentUserRow | undefined) ?? null;

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Username conflict check
    if (requestedUsername) {
      const existingUsernameResult = await db.execute<{ id: string }>(sql`
        SELECT "id"
        FROM "User"
        WHERE "username" = ${requestedUsername}
          AND "id" <> ${session.user.id}
        LIMIT 1
      `);
      const existingUsername = (existingUsernameResult.rows?.[0] as { id: string } | undefined) ?? null;
      if (existingUsername) {
        // Use safe debug logger for sensitive values
        logging.debugSensitive("Username already in use", {
          requestId,
          userId: session.user.id,
        });
        return NextResponse.json(
          { error: "Username already in use" },
          { status: 409 }
        );
      }
    }

    // Username changes are allowed any time (no cooldown).
    const usernameIsChanging = !!(requestedUsername && requestedUsername !== currentUser.username);

    // Email change flow: do NOT change email immediately.
    // Instead, store it as pendingEmail and send a verification link to the new email.
    const emailChanged = !!(normalizedEmail && normalizedEmail !== currentUser.email);

    // Security: require current password for email changes on password-based accounts.
    if (emailChanged && currentUser.passwordHash) {
      const provided = validationResult.data.currentPassword;
      if (!provided) {
        return NextResponse.json(
          { error: "Current password is required to change email" },
          { status: 403 }
        );
      }

      const ok = await bcrypt.compare(provided, currentUser.passwordHash);
      if (!ok) {
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 403 }
        );
      }
    }

    // Email conflict check: block if another user already has it OR has it pending.
    if (normalizedEmail && emailChanged) {
      const existingUserResult = await db.execute<{ id: string }>(sql`
        SELECT "id"
        FROM "User"
        WHERE "id" <> ${session.user.id}
          AND (
            "email" = ${normalizedEmail}
            OR "pendingEmail" = ${normalizedEmail}
          )
        LIMIT 1
      `);
      const existingUser = (existingUserResult.rows?.[0] as { id: string } | undefined) ?? null;

      if (existingUser) {
        logging.debugSensitive("Email already in use", {
          requestId,
          userId: session.user.id,
        });
        return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      }
    }

    // If the user sends the same email as current, treat it as a "no-op".
    // If there is a pendingEmail, cancel it (user effectively reverted).
    const cancelPendingEmail = !!(
      normalizedEmail &&
      !emailChanged &&
      currentUser.pendingEmail
    );


    // Prepare email change request info for response.
    let emailChange:
      | {
          requested: string;
          sent: boolean;
          retryAfterSeconds?: number;
        }
      | undefined;

    // Cancel pending email request if needed.
    if (cancelPendingEmail) {
      await db.execute(sql`
        UPDATE "User"
        SET
          "pendingEmail" = NULL,
          "pendingEmailRequestedAt" = NULL,
          "emailVerifyToken" = NULL,
          "emailVerifyTokenExpiry" = NULL,
          "emailVerificationAttempts" = 0,
          "emailVerifyOtpHash" = NULL,
          "emailVerifyOtpExpiry" = NULL,
          "emailVerifyOtpSentAt" = NULL,
          "emailVerifyOtpFailedAttempts" = 0,
          "updatedAt" = NOW()
        WHERE "id" = ${session.user.id}
      `);
    }

    // Start an email change request (pending) if needed.
    if (normalizedEmail && emailChanged) {
      const existingPending = currentUser.pendingEmail?.toLowerCase().trim() ?? null;
      const samePendingRequest = existingPending && existingPending === normalizedEmail;

      if (samePendingRequest && currentUser.emailVerifyOtpSentAt) {
        const cooldownMs = RESEND_COOLDOWN_SECONDS * 1000;
        const elapsed = Date.now() - currentUser.emailVerifyOtpSentAt.getTime();
        if (elapsed < cooldownMs) {
          const retryAfterSeconds = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
          emailChange = { requested: normalizedEmail, sent: false, retryAfterSeconds };
        }
      }

      if (!emailChange) {
      const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const pepper = process.env.EMAIL_OTP_PEPPER?.trim() || "";
      const hashedOtp = createHash("sha256")
        .update(`${session.user.id}:${otp}:${pepper}`)
        .digest("hex");
      const otpExpiry = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

      emailChange = { requested: normalizedEmail, sent: false };

      const sentAt = new Date();

      await db.execute(sql`
        UPDATE "User"
        SET
          "pendingEmail" = ${normalizedEmail},
          "pendingEmailRequestedAt" = NOW(),
          "emailVerifyToken" = NULL,
          "emailVerifyTokenExpiry" = NULL,
          "emailVerificationAttempts" = COALESCE("emailVerificationAttempts", 0) + 1,
          "emailVerifyOtpHash" = ${hashedOtp},
          "emailVerifyOtpExpiry" = ${otpExpiry},
          "emailVerifyOtpSentAt" = ${sentAt},
          "emailVerifyOtpFailedAttempts" = 0,
          "updatedAt" = NOW()
        WHERE "id" = ${session.user.id}
      `);

      const sendResult = await sendVerificationOtpEmail(normalizedEmail, otp, OTP_TTL_MINUTES);
      if (!sendResult.success) {
        // Cleanup: prevent being stuck with a pending change that can't be completed.
        await db.execute(sql`
          UPDATE "User"
          SET
            "pendingEmail" = NULL,
            "pendingEmailRequestedAt" = NULL,
            "emailVerifyToken" = NULL,
            "emailVerifyTokenExpiry" = NULL,
            "emailVerificationAttempts" = 0,
            "emailVerifyOtpHash" = NULL,
            "emailVerifyOtpExpiry" = NULL,
            "emailVerifyOtpSentAt" = NULL,
            "emailVerifyOtpFailedAttempts" = 0,
            "updatedAt" = NOW()
          WHERE "id" = ${session.user.id}
        `);
        return NextResponse.json(
          { error: "Failed to send verification email" },
          { status: 500 }
        );
      }
      emailChange.sent = true;
      }
    }

    // Apply non-email profile updates.
    if (usernameIsChanging && normalizedAvatar !== undefined) {
      await db.execute(sql`
        UPDATE "User"
        SET
          "username" = ${requestedUsername!},
          "usernameLastChangedAt" = NOW(),
          "image" = ${normalizedAvatar},
          "updatedAt" = NOW()
        WHERE "id" = ${session.user.id}
      `);
    } else if (usernameIsChanging) {
      await db.execute(sql`
        UPDATE "User"
        SET
          "username" = ${requestedUsername!},
          "usernameLastChangedAt" = NOW(),
          "updatedAt" = NOW()
        WHERE "id" = ${session.user.id}
      `);
    } else if (normalizedAvatar !== undefined) {
      await db.execute(sql`
        UPDATE "User"
        SET
          "image" = ${normalizedAvatar},
          "updatedAt" = NOW()
        WHERE "id" = ${session.user.id}
      `);
    }

    const updatedResult = await db.execute<UpdatedUserRow>(sql`
      SELECT
        "id",
        "username",
        "email",
        "pendingEmail",
        "emailVerified",
        "updatedAt",
        "usernameLastChangedAt"
      FROM "User"
      WHERE "id" = ${session.user.id}
      LIMIT 1
    `);

    const updatedUser = (updatedResult.rows?.[0] as UpdatedUserRow | undefined) ?? null;
    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Keep PlayerProfile in sync (username + avatar)
    if (profileData || requestedUsername) {
      const nextProfileUsername = updatedUser.username;

      await syncPlayerProfile({
        userId: session.user.id,
        username: nextProfileUsername || updatedUser.username,
        update: {
          ...(nextProfileUsername && { username: nextProfileUsername }),
          ...(normalizedAvatar !== undefined && { avatar: normalizedAvatar }),
          ...(hideFromLeaderboardPatch !== undefined && {
            hideFromLeaderboard: hideFromLeaderboardPatch,
          }),
        },
        create: {
          username: nextProfileUsername || updatedUser.username,
          avatar: normalizedAvatar ?? null,
          ...(hideFromLeaderboardPatch !== undefined && {
            hideFromLeaderboard: hideFromLeaderboardPatch,
          }),
        },
      });
      void refreshLeaderboardProfileCache(session.user.id).catch(() => {
        // ignore
      });
    }

    logUserOperation.success(requestId, "update_user_profile", {
      userId: updatedUser.id,
      fieldsUpdated: Object.keys(validationResult.data).filter(
        key => validationResult.data[key as keyof typeof validationResult.data]
      ),
      emailChanged,
    });


    return NextResponse.json({
      user: updatedUser,
      message: emailChange?.requested
        ? emailChange.sent
          ? "Verification code sent. Your email will update after verification."
          : emailChange.retryAfterSeconds
            ? "A verification code was recently sent. Please wait before requesting another."
            : "Verification code request received."
        : cancelPendingEmail
          ? "Email change canceled."
          : "Profile updated successfully",
      emailChange,
    });
  } catch (error) {
    logUserOperation.error(requestId, "update_user_profile", error, {
      operationPhase: "update_user_profile",
    });

    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete user account
 */
export async function DELETE(req: NextRequest) {
  const requestId = uuidv4();

  const { allowed, headers } = await rateLimiter.applyRateLimit(req, "/api/user:DELETE");
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }

  // CSRF for unsafe method
  const csrfError = validateCSRF(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      logging.warn("Unauthorized user deletion attempt", {
        requestId,
        service: SERVICE_TYPE
      });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    logUserOperation.start(requestId, "delete_user_account", session.user.id);

    const userId = session.user.id;

    // Safe debug logging for account deletion
    logging.debugSensitive("User account deletion started", {
      requestId,
      userId
    });

    // Delete user and all related data (cascade)
    // Use a non-interactive transaction for better compatibility in serverless.
    await db.execute(sql`DELETE FROM "PlayerProfile" WHERE "userId" = ${userId}`);
    await db.execute(sql`DELETE FROM "SessionStat" WHERE "userId" = ${userId}`);
    await db.execute(sql`DELETE FROM "Session" WHERE "userId" = ${userId}`);
    await db.execute(sql`DELETE FROM "Account" WHERE "userId" = ${userId}`);
    await db.execute(sql`DELETE FROM "Authenticator" WHERE "userId" = ${userId}`);
    await db.execute(sql`DELETE FROM "User" WHERE "id" = ${userId}`);

    // Best-effort: clear Redis keys for this user.
    try {
      await connectIfNeeded();
      await redis.del(`user:longterm:${userId}`, `user:sessions:${userId}`);
    } catch (error) {
      logging.warn("Failed to delete user Redis keys", {
        requestId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logUserOperation.success(requestId, "delete_user_account", { userId });

    // Production-safe success logging
    logging.info("User account deleted successfully", {
      requestId,
      userId,
      service: SERVICE_TYPE
    });

    const response = NextResponse.json({
      message: "Account deleted successfully",
    });

    response.cookies.set({
      name: "__flash_success",
      value: "account_deleted",
      path: "/",
      sameSite: "lax",
      maxAge: 60,
      secure: process.env.NODE_ENV === "production",
    });

    // Best-effort: clear Auth.js / NextAuth session cookies so the browser is treated as logged out.
    // This is important for JWT sessions where deleting the DB user does not invalidate the cookie.
    const cookieNames = [
      // Auth.js v5
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "authjs.csrf-token",
      "__Host-authjs.csrf-token",
      "authjs.callback-url",
      "__Secure-authjs.callback-url",

      // NextAuth legacy names (defensive)
      "next-auth.session-token",
      "__Secure-next-auth.session-token",
      "next-auth.csrf-token",
      "__Host-next-auth.csrf-token",
      "next-auth.callback-url",
      "__Secure-next-auth.callback-url",
    ];

    for (const name of cookieNames) {
      response.cookies.set({
        name,
        value: "",
        path: "/",
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    const prismaCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;

    logUserOperation.error(requestId, "delete_user_account", error, {
      operationPhase: "delete_user_account",
      prismaCode,
    });

    return NextResponse.json(
      { error: "Failed to delete account", requestId, ...(prismaCode ? { code: prismaCode } : {}) },
      { status: 500 }
    );
  }
}