import prisma  from "@/features/auth/lib/db";
import { randomBytes, createHash } from "crypto";


export async function generateResetToken(email: string) {
  if (!email || typeof email !== "string") {
    throw new Error("INVALID_EMAIL");
  }
  
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) throw new Error("USER_NOT_FOUND");
  if (!user.passwordHash) throw new Error("SOCIAL_AUTH_ACCOUNT");

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256").update(rawToken).digest("hex");

  const resetTokenExpiry = new Date(Date.now() + 3600000);

  await prisma.user.update({
    where: { email },
    data: {
      resetToken: hashedToken,
      resetTokenExpiry,
      passwordResetRequests: { increment: 1 },
    },
  });

  return rawToken;
}

export async function validateResetToken(token: string) {
  const hashedToken = createHash("sha256").update(token).digest("hex");
  
    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        resetTokenExpiry: { gt: new Date() },
      },
    });
  
    if (!user) throw new Error("INVALID_OR_EXPIRED_TOKEN");
    return user;
  }
    



export async function generateEmailVerificationToken(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.emailVerified) throw new Error("EMAIL_ALREADY_VERIFIED");

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256").update(rawToken).digest("hex");

  const tokenExpiry = new Date(Date.now() + 24 * 3600 * 1000);

  await prisma.user.update({
    where: { email },
    data: {
      emailVerifyToken: hashedToken,
      emailVerifyTokenExpiry: tokenExpiry,
      emailVerificationAttempts: { increment: 1 },
    },
  });

  return rawToken;
}

export async function validateEmailToken(token: string) {
  const hashedToken = createHash("sha256").update(token).digest("hex");
  
  const user = await prisma.user.findFirst({
    where: {
      emailVerifyToken: hashedToken,
      emailVerifyTokenExpiry: { gt: new Date() }
    }
  });

  if (!user) throw new Error("INVALID_OR_EXPIRED_TOKEN");
  return user;
}