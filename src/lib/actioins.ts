// lib/actions.ts
"use server";

import { schema } from "@/lib/schema";
import db from "@/lib/db";
import { saltAndHashPassword } from "@/utils/password";
import { ZodError } from "zod";

export const signUp = async (formData: FormData) => {
  try {
    const email = formData.get("email");
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");
    const username = formData.get("username") as string;


    // التحقق من تطابق كلمات المرور
    if (password !== confirmPassword) {
      return { success: false, error: "Passwords do not match" };
    }

    // التحقق من صحة البيانات باستخدام Zod
    const validatedData = schema.parse({ email, password });
    
    await db.user.create({
      data: {
        email: validatedData.email.toLowerCase(),
        passwordHash: await saltAndHashPassword(validatedData.password),
        username: username,
      },
    });

    return { success: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Sing up failed. Try again later." };
  }
};