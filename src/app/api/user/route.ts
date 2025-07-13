import { auth } from "@/features/auth/auth";
import { prisma } from "@/lib/prisma";
import {
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/log/loggingUtils";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const SERVICE_TYPE = "USER-API";
const FILE_PATH = "src/app/api/user/route.ts";

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
  preferences: z
    .object({
      theme: z.enum(["light", "dark", "system"]).optional(),
      language: z.string().optional(),
      notifications: z.boolean().optional(),
      soundEnabled: z.boolean().optional(),
    })
    .optional(),
});

/**
 * GET - Get current user profile
 */
export async function GET(req: NextRequest) {
  const requestId = uuidv4();

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", FILE_PATH);

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        playerProfile: {
          select: {
            level: true,
            experience: true,
            wordsPerMinute: true,
            accuracy: true,
            gamesPlayed: true,
            preferences: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
      userId: user.id,
      hasProfile: !!user.playerProfile,
    });

    return NextResponse.json({
      user: {
        ...user,
        playerProfile: user.playerProfile || {
          level: 1,
          experience: 0,
          wordsPerMinute: 0,
          accuracy: 0,
          gamesPlayed: 0,
          preferences: {},
        },
      },
    });
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
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
    logRequestStart(requestId, SERVICE_TYPE, "PATCH", FILE_PATH);

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const validationResult = UpdateUserSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { name, email, preferences } = validationResult.data;

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: session.user.id },
        },
      });

      if (existingUser) {
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 409 }
        );
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(name && { name }),
        ...(email && { email, emailVerified: null }), // Reset verification if email changed
      },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        updatedAt: true,
      },
    });

    // Update player preferences if provided
    if (preferences) {
      await prisma.playerProfile.upsert({
        where: { userId: session.user.id },
        update: {
          preferences: {
            ...(await prisma.playerProfile.findUnique({
              where: { userId: session.user.id },
              select: { preferences: true },
            }))?.preferences,
            ...preferences,
          },
        },
        create: {
          userId: session.user.id,
          level: 1,
          experience: 0,
          wordsPerMinute: 0,
          accuracy: 0,
          gamesPlayed: 0,
          preferences,
        },
      });
    }

    logRequestSuccess(requestId, SERVICE_TYPE, "PATCH", FILE_PATH, {
      userId: updatedUser.id,
      fieldsUpdated: Object.keys(validationResult.data),
      emailChanged: !!email,
    });

    return NextResponse.json({
      user: updatedUser,
      message: "Profile updated successfully",
    });
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
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

  try {
    logRequestStart(requestId, SERVICE_TYPE, "DELETE", FILE_PATH);

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Delete user and all related data (cascade)
    await prisma.$transaction(async (tx) => {
      // Delete player profile first
      await tx.playerProfile.deleteMany({
        where: { userId: session.user.id },
      });

      // Delete user sessions
      await tx.session.deleteMany({
        where: { userId: session.user.id },
      });

      // Delete password reset requests
      await tx.passwordResetRequest.deleteMany({
        where: { userId: session.user.id },
      });

      // Finally delete the user
      await tx.user.delete({
        where: { id: session.user.id },
      });
    });

    logRequestSuccess(requestId, SERVICE_TYPE, "DELETE", FILE_PATH, {
      userId: session.user.id,
    });

    return NextResponse.json({
      message: "Account deleted successfully",
    });
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      operationPhase: "delete_user_account",
    });

    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}