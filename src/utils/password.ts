// utils/password.ts
import bcrypt from "bcryptjs"

export async function saltAndHashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10) 
  const hashedPassword = await bcrypt.hash(password, salt) 
  return hashedPassword
}
