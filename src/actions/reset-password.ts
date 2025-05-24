// src/actions/reset-password.ts
"use server";

import { headers } from "next/headers";
import prisma from "@/features/auth/lib/db";

import { saltAndHashPassword } from "@/features/auth/utils/password";
import bcrypt from "bcrypt";
import { resetPasswordSchema } from "@/schemas/authSchema";
import { generateResetToken, validateResetToken } from "@/features/auth/utils/tokens";
import { checkRateLimit } from "@/features/auth/lib/rate-limiter";
import { sendPasswordResetEmail } from "@/features/auth/providers/resend";
import { mapErrorToMessage } from "@/constants/errors";

export type PasswordState = {
  success: boolean;
  error?: string | null;
};

export async function resetPassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
    const headersInstance = await headers();
    const ip = (headersInstance.get("x-forwarded-for")?.split(',')[0]?.trim()) || "anonymous";

  if (!(await checkRateLimit(ip))) {
    return { 
      success: false, 
      error: mapErrorToMessage("TOO_MANY_REQUESTS") 
    };
  }

  try {
    const email = formData.get("email") as string;
    if (!email) throw new Error("EMAIL_REQUIRED");

    const user = await prisma.user.findUnique({ 
      where: { email },
      select: { id: true, passwordHash: true }
    });
    
    if (!user) throw new Error("USER_NOT_FOUND");
    if (!user.passwordHash) throw new Error("SOCIAL_AUTH_ACCOUNT");

    const token = await generateResetToken(email);

    const { success, error } = await sendPasswordResetEmail(email, token);
    if (!success) throw new Error(error || "FAILED_TO_SEND_EMAIL");

    return { success: true };
  } catch (error) {
    const errorKey = error instanceof Error ? error.message : "UNKNOWN_ERROR";
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
  return !(await bcrypt.compare(newPassword, currentPasswordHash));
}

export async function updatePassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  try {
    const token = formData.get("token") as string;
    if (!token) throw new Error("INVALID_TOKEN");

    const validation = resetPasswordSchema.safeParse({
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
      token,
    });

    if (!validation.success) {
      const errors = validation.error.flatten();
      return {
        success: false,
        error: errors.formErrors.join(", ") || mapErrorToMessage("VALIDATION_ERROR"),
      };
    }

    const { password } = validation.data;
    const user = await validateResetToken(token);

    // منع إعادة استخدام كلمة المرور القديمة
    if (!(await validateNewPassword(password, user.passwordHash!))) {
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

    return { success: true };
  } catch (error) {
    const errorKey = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return {
      success: false,
      error: mapErrorToMessage(errorKey),
    };
  }
}