// lib/actions.ts
"use server";

import { signUpSchema } from "@/schemas/authSchema";
import db from "@/features/auth/lib/db";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import { ZodError } from "zod";
import { resendVerificationEmail } from "@/actions/email-verification";
import { mapErrorToMessage } from "@/constants/errors"; 
import { cacheLevel, cacheXP } from "@/features/level/server-utils/userCache";
import { logging } from '@/log/ServerLogger'; 

export const signUp = async (formData: FormData) => {
  try {
    logging.info("Starting user sign-up process");

    const rawData = {
      email: formData.get("email"),
      username: formData.get("username"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    };

    // Validate form data
    logging.debug("Validating form data", { email: rawData.email, username: rawData.username });
    const validatedData = signUpSchema.parse(rawData);
    logging.info("Form data validated successfully");

    // Check for existing user
    logging.debug("Checking for existing user", { email: validatedData.email, username: validatedData.username });
    const existingUser = await db.user.findFirst({
      where: {
        OR: [
          { email: validatedData.email.toLowerCase() },
          { username: validatedData.username.toLowerCase() }
        ]
      }
    });

    if (existingUser) {
      const conflictField = existingUser.email === validatedData.email.toLowerCase() 
        ? "email" 
        : "username";
      logging.warn(`Conflict detected: ${conflictField} is already taken`, { [conflictField]: existingUser[conflictField] });
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

    // Create user and profile in a transaction
    logging.info("Creating new user and player profile");
    const { user, profile } = await db.$transaction(async (prisma) => {
      // 1. Create user
      logging.debug("Hashing password");
      const hashedPassword = await saltAndHashPassword(validatedData.password);
      logging.debug("Creating user in database", { email: validatedData.email, username: validatedData.username });
      const user = await prisma.user.create({
        data: {
          email: validatedData.email.toLowerCase(),
          username: validatedData.username.toLowerCase(),
          passwordHash: hashedPassword,
        },
      });
    
      // 2. Create player profile
      logging.debug("Creating player profile", { userId: user.id });
      const profile = await prisma.playerProfile.create({
        data: {
          userId: user.id,
          username: user.username,
          level: 1,
          xp: 0,
          achievements: [],
          avatar: null,
        }
      });
    
      return { user, profile };
    });
    logging.info("User created successfully", { userId: user.id, username: user.username });
    logging.info("Player profile created", { userId: user.id, level: profile.level, xp: profile.xp });

    // Send verification email
    logging.debug("Sending verification email", { email: user.email });
    const verificationResult = await resendVerificationEmail(user.email);
    
    if (!verificationResult.success) {
      logging.error("Failed to send verification email", new Error(verificationResult.error));
      return {
        success: false,
        error: mapErrorToMessage("USER_CREATED_BUT_EMAIL_NOT_SENT"), 
        details: { error: verificationResult.error }
      };
    }
    logging.info("Verification email sent successfully");

    logging.info("Sign-up process completed successfully");
    return { success: true };
  } catch (error) {
    // Handle validation errors
    if (error instanceof ZodError) {
      logging.error("Validation error occurred during sign-up", error, { issues: error.issues });
      return { 
        success: false, 
        error: "Validation failed",
        details: error.flatten()
      };
    }

    // Log unexpected errors
    logging.error("Unexpected error during sign-up", error);
    return { 
      success: false, 
      error: "Registration failed. Please try again later." 
    };
  }
};

export const updateUserLevel = async (userId: string, newLevel: number, newXP: number) => {
  try {
    logging.info("Starting level update", { userId, newLevel, newXP });

    // Update database
    logging.debug("Updating player profile in database", { userId, newLevel, newXP });
    const updatedProfile = await db.playerProfile.update({
      where: { userId },
      data: {
        level: newLevel,
        xp: newXP,
      },
    });
    logging.info("Player profile updated successfully", { userId, level: updatedProfile.level, xp: updatedProfile.xp });

    // Update cache
    logging.debug("Updating cache for level and XP", { userId });
    await cacheLevel(`user:${userId}:level`, updatedProfile.level);
    await cacheXP(`user:${userId}:xp`, updatedProfile.xp);
    logging.debug("Cache updated successfully", { userId });

    logging.info("Level update completed successfully", { userId });
    return { success: true, profile: updatedProfile };
  } catch (error) {
    logging.error("Failed to update user level", error, { userId, newLevel, newXP });
    return { success: false, error: 'LEVEL_UPDATE_FAILED' };
  }
};