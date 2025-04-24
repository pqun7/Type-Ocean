// lib/schema.ts
import { z } from "zod";

const usernameValidation = z
  .string()
  .trim()
  .min(3, { message: "Username must be at least 3 characters" })
  .max(20, { message: "Username cannot exceed 20 characters" })
  .regex(/^[a-zA-Z0-9_]+$/, {
    message: "Username can only contain letters, numbers, and underscores",
  });

const passwordValidation = z
  .string()
  .min(8, { message: "Password must be at least 8 characters" })
  .regex(/[A-Z]/, {
    message: "Password must contain at least one uppercase letter",
  })
  .regex(/\d/, {
    message: "Password must contain at least one number",
  })
 

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(1),
});

const signUpSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email({ message: "Invalid email address" })
      .max(100, { message: "Email is too long" }),

    username: usernameValidation,

    password: passwordValidation,

    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type LoginSchema = z.infer<typeof loginSchema>;
type SignUpSchema = z.infer<typeof signUpSchema>;

export { loginSchema, type LoginSchema, signUpSchema, type SignUpSchema };
