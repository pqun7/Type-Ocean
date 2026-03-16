// src/utils/db.ts
import { or, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import bcrypt from "bcryptjs"

export async function getUserFromDb(username: string, plainPassword: string) {
  const normalizedInput = username.toLowerCase().trim();
  const normalizedUsername = normalizedInput.replace(/\s+/g, "");
  
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      emailVerified: users.emailVerified,
      image: users.image,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(or(eq(users.username, normalizedUsername), eq(users.email, normalizedInput)))
    .limit(1);

  const user = rows[0] ?? null;

  if (!user) throw new Error("USER_NOT_FOUND");
  if (!user.passwordHash) throw new Error("NO_PASSWORD_SET");
  
  const isValid = await bcrypt.compare(plainPassword, user.passwordHash);
  if (!isValid) throw new Error("INCORRECT_PASSWORD");

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
  };
}