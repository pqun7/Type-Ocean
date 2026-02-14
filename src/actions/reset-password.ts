"use server";

import { headers } from "next/headers";
import prisma from "@/features/auth/lib/db";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import bcrypt from "bcrypt";
import { resetPasswordSchema } from "@/schemas/authSchema";
import { generateResetToken, validateResetToken } from "@/features/auth/utils/tokens";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendPasswordResetEmail } from "@/features/auth/providers/nodemailer";
import { mapErrorToMessage } from "@/constants/errors";
import { logging } from "@/log/ServerLogger";

export type PasswordState = {
  success: boolean;
  error?: string | null;
};

// Safe logging utilities for password operations
const logPasswordOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Password operation started: ${operation}`, metadata || {});
  },
  
  success: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Password operation completed: ${operation}`, metadata || {});
  },
  
  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Password operation failed: ${operation}`, error, metadata);
  }
};

export async function resetPassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  const headersInstance = await headers();
  const ip = (headersInstance.get("x-forwarded-for")?.split(',')[0]?.trim()) || "anonymous";

  const endpoint = '/api/auth/reset-password';
  
  logPasswordOperation.start("password_reset_request", {
    ip,
    endpoint
  });

  const { allowed } = await checkRateLimit(endpoint, ip);
  if (!allowed) {
    logPasswordOperation.error("password_reset_request", new Error("Rate limit exceeded"), {
      ip,
      endpoint
    });
    return { 
      success: false, 
      error: mapErrorToMessage("TOO_MANY_REQUESTS") 
    };
  }

  try {
    const email = formData.get("email") as string;
    if (!email) throw new Error("EMAIL_REQUIRED");

    // Safe debug logging for reset attempt
    logging.debugSensitive("Password reset attempt", {
      email,
      ip,
      endpoint
    });

    // Always return success to prevent user enumeration
    // This simulates sending an email even if user doesn't exist
    const user = await prisma.user.findUnique({ 
      where: { email },
      select: { id: true, passwordHash: true }
    });
    
    if (user) {
      // Only send reset email if user exists and has password
      if (!user.passwordHash) {
        // Still return success to prevent enumeration
        logPasswordOperation.success("password_reset_request", {
          userId: user.id,
          status: "social_account_no_password",
          emailSent: false
        });
        return { success: true };
      }

      const token = await generateResetToken(email);
      const { success, error } = await sendPasswordResetEmail(email, token);
      
      // Don't expose email sending failures to prevent enumeration
      if (!success) {
        logPasswordOperation.error("password_reset_request", new Error("Failed to send reset email"), {
          userId: user.id,
          email,
          internalError: error
        });
      } else {
        logPasswordOperation.success("password_reset_request", {
          userId: user.id,
          status: "reset_email_sent",
          emailSent: true
        });
      }
    } else {
      // User doesn't exist, but return success to prevent enumeration
      logPasswordOperation.success("password_reset_request", {
        status: "user_not_found_but_success_returned",
        emailSent: false
      });
    }

    // Always return success regardless of whether user exists
    return { success: true };
    
  } catch (error) {
    // Generic error message
    logPasswordOperation.error("password_reset_request", error, {
      ip,
      endpoint
    });
    return {
      success: false,
      error: "An error occurred. Please try again later.",
    };
  }
}

export async function validateNewPassword(
  newPassword: string,
  currentPasswordHash: string
): Promise<boolean> {
  return !(await bcrypt.compare(newPassword, currentPasswordHash));
}

export async function updatePassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  const requestId = `update-pwd-${Date.now()}`;
  
  try {
    const token = formData.get("token") as string;
    if (!token) throw new Error("INVALID_TOKEN");

    logPasswordOperation.start("update_password", {
      requestId,
      hasToken: !!token
    });

    const validation = resetPasswordSchema.safeParse({
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
      token,
    });

    if (!validation.success) {
      const errors = validation.error.flatten();
      logPasswordOperation.error("update_password", new Error("Validation failed"), {
        requestId,
        validationErrors: errors.formErrors
      });
      return {
        success: false,
        error: errors.formErrors.join(", ") || mapErrorToMessage("VALIDATION_ERROR"),
      };
    }

    const { password } = validation.data;
    const user = await validateResetToken(token);

    // Safe debug logging for password update
    logging.debugSensitive("Password update attempt", {
      requestId,
      userId: user.id,
      email: user.email
    });

    // منع إعادة استخدام كلمة المرور القديمة
    if (!(await validateNewPassword(password, user.passwordHash!))) {
      logPasswordOperation.error("update_password", new Error("Password same as current"), {
        requestId,
        userId: user.id
      });
      throw new Error("PASSWORD_SAME_AS_CURRENT");
    }

    // استخدام معاملة قاعدة بيانات آمنة
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await saltAndHashPassword(password),
          resetToken: null,
          resetTokenExpiry: null,
          passwordResetRequests: { increment: 1 },
        },
      }),
      
      prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: null,
          resetTokenExpiry: null
        }
      })
    ]);

    logPasswordOperation.success("update_password", {
      requestId,
      userId: user.id,
      status: "password_updated_successfully"
    });

    // Production-safe logging
    logging.info("Password updated successfully", {
      requestId,
      userId: user.id
    });

    return { success: true };
  } catch (error) {
    const errorKey = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    logPasswordOperation.error("update_password", error, {
      requestId,
      errorKey
    });
    return {
      success: false,
      error: mapErrorToMessage(errorKey),
    };
  }
}