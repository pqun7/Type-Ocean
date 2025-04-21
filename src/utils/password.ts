// utils/password.ts
import bcrypt from "bcryptjs"

export async function saltAndHashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10) // توليد salt عشوائي
  const hashedPassword = await bcrypt.hash(password, salt) // تجزئة الباسورد مع salt
  return hashedPassword
}
