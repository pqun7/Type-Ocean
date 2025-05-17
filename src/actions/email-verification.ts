// src/actions/email-verification.ts
"use server";

import { headers } from "next/headers";
import { generateEmailVerificationToken } from "@/utils/tokens";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationEmail } from "@/providers/resend";
import { mapErrorToMessage } from "@/constants/errors";
import prisma  from "@/lib/db";

export async function resendVerificationEmail(email: string) {
  try {
    const headersInstance = await headers();
    const ip = headersInstance.get("x-forwarded-for")?.split(',')[0]?.trim() || "anonymous";

    // التحقق من حالة البريد مسبقًا
    const user = await prisma.user.findUnique({
      where: { email },
      select: { emailVerified: true }
    });

    if (user?.emailVerified) {
      return { error: "EMAIL_ALREADY_VERIFIED" };
    }

    if (!(await checkRateLimit(ip))) {
      return { error: "TOO_MANY_REQUESTS" };
    }

    const token = await generateEmailVerificationToken(email);
    const { success, error } = await sendVerificationEmail(email, token);

    return success 
      ? { success: true } 
      : { error: mapErrorToMessage(error || "FAILED_TO_SEND_EMAIL") };

  } catch (error) {
    const errorMessage = (error as Error).message;
    return { error: mapErrorToMessage(errorMessage) };
  }
}