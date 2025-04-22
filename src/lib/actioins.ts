// lib/actions.ts
"use server";

import { signUpSchema } from "@/lib/schema";
import db from "@/lib/db";
import { saltAndHashPassword } from "@/utils/password";
import { ZodError } from "zod";

export const signUp = async (formData: FormData) => {
  try {
    const email = formData.get("email");
    const username = formData.get("username") as string;
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    console.log("[signUp] Received form data:", {
      email,
      username,
      passwordExists: !!password,
      confirmPasswordExists: !!confirmPassword,
    });

    // التحقق من تطابق كلمات المرور
    if (password !== confirmPassword) {
      console.log("[signUp] Passwords do not match");
      return { success: false, error: "Passwords do not match" };
    }

    // التحقق من صحة البيانات باستخدام Zod
    const validatedData = signUpSchema.parse({ email, username, password });
    console.log("[signUp] Validated data:", validatedData);

    const hashedPassword = await saltAndHashPassword(validatedData.password);
    console.log("[signUp] Password hashed");

    const createdUser = await db.user.create({
      data: {
        email: validatedData.email.toLowerCase(),
        username: username.toLowerCase(),
        passwordHash: hashedPassword,
      },
    });

    console.log("[signUp] User created:", {
      id: createdUser.id,
      email: createdUser.email,
      username: createdUser.username,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof ZodError) {
      console.log("[signUp] Zod validation error:", error.errors);
      return { success: false, error: error.errors[0].message };
    }
    console.error("[signUp] Unknown error:", error);
    return { success: false, error: "Sing up failed. Try again later." };
  }
};
