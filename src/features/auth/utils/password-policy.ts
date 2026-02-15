import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export const passwordValidation = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` })
  .max(PASSWORD_MAX_LENGTH, { message: `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters` })
  .regex(/[A-Z]/, {
    message: "Password must contain at least one uppercase letter",
  })
  .regex(/\d/, {
    message: "Password must contain at least one number",
  });

export function passwordMeetsRequirements(password: string): boolean {
  return passwordValidation.safeParse(password).success;
}
