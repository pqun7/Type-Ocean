import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { logging } from "@/log/ServerLogger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const SERVICE_TYPE = "USER-API";

const UpdateUserSchema = z.object({
  username: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
  profileData: z
    .object({
      username: z.string().min(1).max(50).optional(),
      avatar: z.string().optional(),
    })
    .optional(),
});

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
export async function GET() {
  const requestId = uuidv4();

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

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: session.user.id },
        },
      });

      if (existingUser) {
        logUserOperation.error(requestId, "update_user_profile", new Error("Email already in use"), {
          userId: session.user.id,
          attemptedEmail: email
        });
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 409 }
        );
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(username && { username }),
        ...(email && { email, emailVerified: null }), // Reset verification if email changed
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
      fieldsUpdated: Object.keys(validationResult.data).filter(key => validationResult.data[key as keyof typeof validationResult.data]),
      emailChanged: !!email,
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