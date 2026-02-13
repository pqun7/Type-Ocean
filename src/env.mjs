import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    AUTH_GITHUB_ID: z.string().optional(),
    AUTH_GITHUB_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_SECRET: z.string().min(32),
    NEXTAUTH_SECRET: z.string().optional(),
    DATABASE_URL: z.string().url(),
    SESSION_MAX_AGE: z.coerce.number().default(2592000), // 30 days

    AUTH_ALLOW_DANGEROUS_EMAIL_ACCOUNT_LINKING: z
      .enum(["true", "false"])
      .optional(),

    REDIS_URL: z.string().optional(),
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.string().optional(),
    REDIS_PASSWORD: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),
  },
  client: {},
  runtimeEnv: {
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_MAX_AGE: process.env.SESSION_MAX_AGE,

    AUTH_ALLOW_DANGEROUS_EMAIL_ACCOUNT_LINKING:
      process.env.AUTH_ALLOW_DANGEROUS_EMAIL_ACCOUNT_LINKING,

    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,

    RESEND_API_KEY: process.env.RESEND_API_KEY,
  },
});