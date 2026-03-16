import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { randomBytes, createHash } from "crypto";


export async function generateResetToken(email: string) {
  if (!email || typeof email !== "string") {
    throw new Error("INVALID_EMAIL");
  }
  
  const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0] ?? null;

  if (!user) throw new Error("USER_NOT_FOUND");
  if (!user.passwordHash) throw new Error("SOCIAL_AUTH_ACCOUNT");

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256").update(rawToken).digest("hex");

  // 15 minutes expiry (short-lived + reduces takeover window)
  const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);

  await db
    .update(users)
    .set({
      resetToken: hashedToken,
      resetTokenExpiry,
      passwordResetRequests: sql`${users.passwordResetRequests} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.email, email));

  return rawToken;
}

export async function validateResetToken(token: string) {
  const hashedToken = createHash("sha256").update(token).digest("hex");
  
    const userRows = await db
      .select()
      .from(users)
      .where(and(eq(users.resetToken, hashedToken), gt(users.resetTokenExpiry, new Date())))
      .limit(1);

    const user = userRows[0] ?? null;
  
    if (!user) throw new Error("INVALID_OR_EXPIRED_TOKEN");
    return user;
  }
    



export async function generateEmailVerificationToken(email: string): Promise<string> {
  const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0] ?? null;
  
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.emailVerified) throw new Error("EMAIL_ALREADY_VERIFIED");

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256").update(rawToken).digest("hex");

  const tokenExpiry = new Date(Date.now() + 24 * 3600 * 1000);

  await db
    .update(users)
    .set({
      emailVerifyToken: hashedToken,
      emailVerifyTokenExpiry: tokenExpiry,
      emailVerificationAttempts: sql`${users.emailVerificationAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.email, email));

  return rawToken;
}

export async function validateEmailToken(token: string) {
  const hashedToken = createHash("sha256").update(token).digest("hex");
  
  const userRows = await db
    .select()
    .from(users)
    .where(and(eq(users.emailVerifyToken, hashedToken), gt(users.emailVerifyTokenExpiry, new Date())))
    .limit(1);

  const user = userRows[0] ?? null;

  if (!user) throw new Error("INVALID_OR_EXPIRED_TOKEN");
  return user;
}