// src/actions/reset-password.ts
"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { saltAndHashPassword } from "@/utils/password";
import bcrypt from "bcrypt";
import { resetPasswordSchema } from "@/lib/schema";
import { generateResetToken, validateResetToken } from "@/utils/tokens";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendPasswordResetEmail } from "@/providers/resend";
import { mapErrorToMessage } from "@/constants/errors"; 


export type PasswordState = {
  success: boolean;
  error?: string | null;
};


const errorMessages: Record<string, string> = {
  USER_NOT_FOUND: "Email is not registered",
  INVALID_OR_EXPIRED_TOKEN: "Reset link is invalid or has expired",
  EMAIL_REQUIRED: "Please enter your email",
  SOCIAL_AUTH_ACCOUNT: "Account uses external login",
  TOO_MANY_REQUESTS: "Too many requests, try again later",
  DEFAULT: "Something went wrong, please try again",
};

export async function resetPassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  console.log("\n===== Starting Password Reset =====");
  console.log("Form Data:", Object.fromEntries(formData.entries()));

  const headersInstance = await headers();
  const ip = headersInstance.get("x-forwarded-for") ?? "anonymous";
  console.log("IP Address:", ip);

  // Rate Limit Check
  console.log("Checking Rate Limit...");
  const allowed = await checkRateLimit(ip);
  console.log("Rate Limit Allowed:", allowed);

  if (!allowed) {
    console.log("Rate Limit Exceeded!");
    return { success: false, error: errorMessages["TOO_MANY_REQUESTS"] };
  }

  try {
    const email = formData.get("email") as string;
    console.log("Processing Email:", email);

    if (!email) {
      console.log("Email is required!");
      throw new Error("EMAIL_REQUIRED");
    }

    console.log("Generating Reset Token...");
    const token = await generateResetToken(email);
    console.log("Generated Token:", token);

    const resetLink = `${process.env.NEXTAUTH_URL}/reset-password/${token}`;
    console.log("Reset Link:", resetLink);

    console.log("Sending Email...");

    const { success, error } = await sendPasswordResetEmail(email, token);
    
    if (!success) {
      console.error("Email Send Error:", error);
      throw new Error("FAILED_TO_SEND_EMAIL");
    }

    console.log("===== Password Reset Completed Successfully =====\n");
    return { success: true };
  } catch (error) {
    console.error("Error during password reset:", error);
    const errorKey = (error as Error).message;
    return {
      success: false,
      error: mapErrorToMessage(errorKey), 
    };
  }
}

export async function validateNewPassword(
  newPassword: string,
  currentPasswordHash: string
): Promise<boolean> {
  const isSame = await bcrypt.compare(newPassword, currentPasswordHash);
  return !isSame; 
}

export async function updatePassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  try {
    const token = formData.get("token") as string;
    console.log("Received Raw Token:", token); 

    if (!token) throw new Error("INVALID_OR_EXPIRED_TOKEN");

    const result = resetPasswordSchema.safeParse({
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
      token: token,
    });

    if (!result.success) {
      const errors = result.error.flatten();
      return {
        success: false,
        error: errors.formErrors.join(", ") || errorMessages.DEFAULT,
      };
    }

    const { password } = result.data;

    console.log("Validating Reset Token...");
    const user = await validateResetToken(token); // Use validateResetToken here
    console.log("Token validated successfully for user:", user.id);

    if (!user.passwordHash) throw new Error("SOCIAL_AUTH_ACCOUNT");

    // check if password is same as old password using bcrypt comparison
    const isValidNewPassword = await validateNewPassword(
      password,
      user.passwordHash
    );

    if (!isValidNewPassword) {
      throw new Error("PASSWORD_SAME_AS_CURRENT");
    }

    const hashedPassword = await saltAndHashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        passwordResetRequests: { increment: 1 },
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Password reset error:", error);
    const errorKey = (error as Error).message;
    return {
      success: false,
      error: mapErrorToMessage(errorKey),
    };
  }
}
