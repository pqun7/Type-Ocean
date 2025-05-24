// src/utils/db.ts
import db from "@/features/auth/lib/db"
import bcrypt from "bcryptjs"

export async function getUserFromDb(username: string, plainPassword: string) {
  const normalizedUsername = username.toLowerCase().trim();
  
  let user = await db.user.findUnique({ 
    where: { username: normalizedUsername } 
  });

  if (!user) {
    user = await db.user.findUnique({
      where: { email: normalizedUsername },
    });
  }

  if (!user) throw new Error("USER_NOT_FOUND");
  if (!user.passwordHash) throw new Error("NO_PASSWORD_SET");
  
  const isValid = await bcrypt.compare(plainPassword, user.passwordHash);
  if (!isValid) throw new Error("INCORRECT_PASSWORD");

  return {
    id: user.id,
    username: user.username,
    email: user.email,
  };
}