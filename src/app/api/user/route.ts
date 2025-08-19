import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
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
  username: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
  profileData: z
    .object({
      username: z.string().min(1).max(50).optional(),
      avatar: z.string().optional(),
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
        username: true, // Changed from 'name' to 'username'
        email: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        profile: { // Changed from 'playerProfile' to 'profile'
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
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
      userId: user.id,
      hasProfile: !!user.profile,
    });

    return NextResponse.json({
      user: {
        ...user,
        profile: user.profile || { // Changed from 'playerProfile' to 'profile'
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

    const { username, email, profileData } = validationResult.data;

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