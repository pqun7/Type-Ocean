// lib/actions.ts
"use server";

import { signUpSchema } from "@/lib/schema";
import db from "@/lib/db";
import { saltAndHashPassword } from "@/utils/password";
import { ZodError } from "zod";
import { resendVerificationEmail } from "@/actions/email-verification";

export const signUp = async (formData: FormData) => {
  try {
    const rawData = {
      email: formData.get("email"),
      username: formData.get("username"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    };

    console.log("[signUp] Received form data:", rawData);

    // Validate data
    const validatedData = signUpSchema.parse(rawData);
    console.log("[signUp] Validated data:", validatedData);

    // Check if user already exists
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

    // Create user
    const hashedPassword = await saltAndHashPassword(validatedData.password);
    const createdUser = await db.user.create({
      data: {
        email: validatedData.email.toLowerCase(),
        username: validatedData.username.toLowerCase(),
        passwordHash: hashedPassword,
      },
    });

    console.log("[signUp] User created:", {
      id: createdUser.id,
      email: createdUser.email,
      username: createdUser.username,
      createdAt: createdUser.createdAt // Good practice to log timestamps
    });

    const verificationResult = await resendVerificationEmail(createdUser.email);
    
    if (!verificationResult.success) {
      console.error("Failed to send verification email:", verificationResult.error);
      return {
        success: false,
        error: "USER_CREATED_BUT_EMAIL_NOT_SENT",
        details: { error: verificationResult.error }
      };
    }

    return { success: true };
  } catch (error) {
    if (error instanceof ZodError) {
      console.log("[signUp] Validation errors:", error.flatten());
      return { 
        success: false, 
        error: "Validation failed",
        details: error.flatten() // Provides structured error info
      };
    }
    
    console.error("[signUp] Error:", error);
    return { 
      success: false, 
      error: "Registration failed. Please try again later." 
    };
  }
};