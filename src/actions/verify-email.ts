"use server";

import { prisma } from "@/lib/db";
import { validateEmailToken } from "@/utils/tokens";

export async function verifyEmail(token: string) {
  try {
    const user = await validateEmailToken(token);
    
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null
      }
    });

    return { success: true };
  } catch (error) {
    console.error(error);
    return { error: "Failed to verify email" };
  }
}