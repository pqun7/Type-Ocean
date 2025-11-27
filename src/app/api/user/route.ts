import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { logging } from "@/log/ServerLogger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { rateLimiter } from "@/lib/rate-limiter"


const SERVICE_TYPE = "USER-API";

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
  profileData: z
    .object({
      username: usernameValidation.optional(),
      avatar: z
        .string()
        .url()
        .max(2048, "Avatar URL too long")
        .refine((v) => /^https?:\/\//i.test(v), "Avatar URL must be http(s)")
        .optional(),
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

    logUserOperation.start(requestId, "get_user_profile", session.user.id);

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        username: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            id: true,
            username: true,
            level: true,
            xp: true,
            achievements: true,
            avatar: true,
          },
        },
      },
    });

    if (!user) {
      logUserOperation.error(requestId, "get_user_profile", new Error("User not found"), {
        userId: session.user.id
      });
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    logUserOperation.success(requestId, "get_user_profile", {
      userId: user.id,
      hasProfile: !!user.profile,
    });

    return NextResponse.json({
      user: {
        ...user,
        profile: user.profile || {
          id: null,
          username: user.username,
          level: 1,
          xp: 0,
          achievements: [],
          avatar: null,
        },
      },
    });
  } catch (error) {
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
        validationErrors: validationResult.error.errors
      });
      return NextResponse.json(
        {
          error: "Invalid input",
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { username, email, profileData } = validationResult.data;

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
    
    // Load current email for safe compare (avoid de-verifying on same email)
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true },
    });

    // Username conflict check (missing previously)
    if (username) {
      const existingUsername = await prisma.user.findFirst({
        where: {
          username: username.toLowerCase(),
          id: { not: session.user.id },
        },
        select: { id: true },
      });
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

    // Check if email is already taken by another user
     // Email conflict check (keep existing, but avoid logging raw email)
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: session.user.id },
        },
      });

      if (existingUser) {
        // Safer PII handling
        logging.debugSensitive("Email already in use", {
          requestId,
          userId: session.user.id,
        });
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 409 }
        );
      }
    }

    // Determine if email actually changed (avoid de-verifying on same email)
    const emailChanged = !!(email && email !== currentUser?.email);

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(username && { username }),
        ...(email && emailChanged && { email, emailVerified: null }),
        ...(email && !emailChanged && { email }), // keep verification status
      },
      select: {
        id: true,
        username: true,
        email: true,
        emailVerified: true,
        updatedAt: true,
      },
    });

    // Update player profile if provided
    if (profileData) {
      await prisma.playerProfile.upsert({
        where: { userId: session.user.id },
        update: {
          ...(profileData.username && { username: profileData.username }),
          ...(profileData.avatar !== undefined && { avatar: profileData.avatar }),
        },
        create: {
          userId: session.user.id,
          username: profileData.username || updatedUser.username,
          level: 1,
          xp: 0,
          achievements: [],
          avatar: profileData.avatar || null,
        },
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
      message: "Profile updated successfully",
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
export async function DELETE() {
  const requestId = uuidv4();

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

    // Safe debug logging for account deletion
    logging.debugSensitive("User account deletion started", {
      requestId,
      userId: session.user.id
    });

    // Delete user and all related data (cascade)
    await prisma.$transaction(async (tx) => {
      // Delete player profile first
      await tx.playerProfile.deleteMany({
        where: { userId: session.user.id },
      });

      // Delete session stats
      await tx.sessionStat.deleteMany({
        where: { userId: session.user.id },
      });

      // Delete user sessions
      await tx.session.deleteMany({
        where: { userId: session.user.id },
      });

      // Delete accounts
      await tx.account.deleteMany({
        where: { userId: session.user.id },
      });

      // Delete authenticators
      await tx.authenticator.deleteMany({
        where: { userId: session.user.id },
      });

      // Finally delete the user
      await tx.user.delete({
        where: { id: session.user.id },
      });
    });

    logUserOperation.success(requestId, "delete_user_account", {
      userId: session.user.id,
    });

    // Production-safe success logging
    logging.info("User account deleted successfully", {
      requestId,
      userId: session.user.id,
      service: SERVICE_TYPE
    });

    return NextResponse.json({
      message: "Account deleted successfully",
    });
  } catch (error) {
    logUserOperation.error(requestId, "delete_user_account", error, {
      operationPhase: "delete_user_account",
    });

    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}