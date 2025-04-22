// src/utils/db.ts
import db from "@/lib/db"
import bcrypt from "bcryptjs"

export async function getUserFromDb(username: string, plainPassword: string) {
  console.log("[getUserFromDb] Looking up user:", username);
  const user = await db.user.findUnique({ where: { username: username.toLowerCase() } });

  if (!user) {
    console.log("[getUserFromDb] User not found");
    return null;
  }

  if (!user.passwordHash) {
    console.log("[getUserFromDb] User has no password hash");
    return null;
  }

  const passwordMatches = await bcrypt.compare(plainPassword, user.passwordHash);
  console.log("[getUserFromDb] Password match:", passwordMatches);

  if (!passwordMatches) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
  };
}