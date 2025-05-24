// src/actions/verify-email.ts
"use server";

import { prisma } from "@/features/auth/lib/db";
import { validateEmailToken } from "@/features/auth/utils/tokens";
import { redirect } from "next/navigation";

export async function verifyEmail(token: string) {
  try {
    const user = await validateEmailToken(token);
    
    if (user.emailVerified) {
      redirect(`/auth?error=EMAIL_ALREADY_VERIFIED`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null,
        emailVerificationAttempts: 0
      }
    });

    redirect("/home?verified=success");
  } catch (error) {
    console.error("Email verification failed:", error);
    redirect("/auth?error=INVALID_VERIFICATION_TOKEN");
  }
}