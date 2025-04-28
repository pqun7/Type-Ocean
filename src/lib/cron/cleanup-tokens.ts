// src/lib/cleanup-tokens.ts
import { prisma } from "@/lib/db";

export async function cleanupExpiredTokens() {
  await prisma.user.updateMany({
    where: {
      resetTokenExpiry: {
        lt: new Date()
      }
    },
    data: {
      resetToken: null,
      resetTokenExpiry: null
    }
  });
}