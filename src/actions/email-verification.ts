// actions/email-verification.ts
"use server";

import { headers } from "next/headers";
import { generateEmailVerificationToken } from "@/utils/tokens";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationEmail } from "@/providers/resend";
import { mapErrorToMessage } from "@/constants/errors"; 

export async function resendVerificationEmail(email: string) {
  try {
    const headersInstance = await headers();
    const ip = headersInstance.get("x-forwarded-for") ?? "anonymous";

    if (!(await checkRateLimit(ip))) {
      return { error: "TOO_MANY_REQUESTS" };
    }

    const token = await generateEmailVerificationToken(email);
    const { success, error } = await sendVerificationEmail(email, token);

    if (!success) {
      throw new Error(error || "FAILED_TO_SEND_EMAIL");
    }

    return { success: true };
  } catch (error) {
    console.error(error);
    const errorMessage = (error as Error).message;
    return { error: mapErrorToMessage(errorMessage) };
  }
}

