// src/utils/db.ts
import db from "@/lib/db"
import bcrypt from "bcryptjs"

export async function getUserFromDb(username: string, plainPassword: string) {
  console.log("[getUserFromDb] Looking up user:", username);
  const user = await db.user.findUnique({ where: { username: username.toLowerCase() } });

  if (!user) {
    console.log("[getUserFromDb] User not found");
    return { success: false, error: "UserNotFound" };
  }

  if (!user.passwordHash) {
    console.log("[getUserFromDb] User has no password hash");
    return { success: false, error: "NoPasswordSet" };
  }


  const passwordMatches = await bcrypt.compare(plainPassword, user.passwordHash);
  console.log("[getUserFromDb] Password match:", passwordMatches);

  if (!passwordMatches) {
    return { success: false, error: "IncorrectPassword" };
  }


  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  };
}