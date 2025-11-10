"use server";

import { signUpSchema } from "@/schemas/authSchema";
import db from "@/features/auth/lib/db";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import { ZodError } from "zod";
import { resendVerificationEmail } from "@/actions/email-verification";
import { mapErrorToMessage } from "@/constants/errors"; 
import { logging } from '@/log/ServerLogger'; 

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

    // Create user and profile in a transaction
    logging.info("Creating new user and player profile", { requestId });
    
    const { user, profile } = await db.$transaction(async (prisma) => {
      // 1. Create user
      logging.debug("Hashing password", { requestId });
      const hashedPassword = await saltAndHashPassword(validatedData.password);
      
      logging.debugSensitive("Creating user in database", {
        requestId,
        email: validatedData.email,
        username: validatedData.username
      });
      
      const user = await prisma.user.create({
        data: {
          email: validatedData.email.toLowerCase(),
          username: validatedData.username.toLowerCase(),
          passwordHash: hashedPassword,
        },
      });
    
      // 2. Create player profile
      logging.debug("Creating player profile", { 
        requestId, 
        userId: user.id 
      });
      
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
    
    // Safe debug logging for user creation
    logging.debugSensitive("User created successfully", {
      requestId,
      userId: user.id,
      username: user.username,
      email: user.email
    });
    
    logging.info("Player profile created", { 
      requestId, 
      userId: user.id, 
      level: profile.level, 
      xp: profile.xp 
    });

    // Send verification email
    logging.debugSensitive("Sending verification email", {
      requestId,
      email: user.email
    });
    
    const verificationResult = await resendVerificationEmail(user.email);
    
    if (!verificationResult.success) {
      logAuthOperation.error("user_signup", new Error("Failed to send verification email"), {
        requestId,
        userId: user.id,
        internalError: verificationResult.error
      });
      
      return {
        success: false,
        error: mapErrorToMessage("USER_CREATED_BUT_EMAIL_NOT_SENT"), 
        details: { error: verificationResult.error }
      };
    }
    
    logging.info("Verification email sent successfully", { requestId });

    logAuthOperation.success("user_signup", {
      requestId,
      userId: user.id,
      status: "user_created_and_verification_sent"
    });

    // Production-safe logging
    logging.info("Sign-up process completed successfully", {
      requestId,
      userId: user.id
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
    
    return { 
      success: false, 
      error: "Registration failed. Please try again later." 
    };
  }
};