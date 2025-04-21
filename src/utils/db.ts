import db from "@/lib/db"
import bcrypt from "bcryptjs"

// src/utils/db.ts
export async function getUserFromDb(email: string, plainPassword: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return null;
  const passwordMatches = await bcrypt.compare(plainPassword, user.passwordHash);
  if (!passwordMatches) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
  };
}
