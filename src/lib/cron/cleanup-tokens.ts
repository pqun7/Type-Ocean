// src/lib/cleanup-tokens.ts
import { prisma } from "@/lib/db";

export async function cleanupExpiredTokens() {
  await prisma.user.updateMany({
    where: {
      OR: [
        { resetTokenExpiry: { lt: new Date() } },
        { emailVerifyTokenExpiry: { lt: new Date() } }
      ]
    },
    data: {
      resetToken: null,
      resetTokenExpiry: null,
      emailVerifyToken: null,
      emailVerifyTokenExpiry: null
    }
  });
}