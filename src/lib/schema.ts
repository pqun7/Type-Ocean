import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(6),
});

type LoginSchema = z.infer<typeof loginSchema>;
type SingUpSchema = z.infer<typeof signUpSchema>;

export { loginSchema, type LoginSchema, signUpSchema, type SingUpSchema};