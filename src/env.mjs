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
    REDIS_TLS: z.enum(["true", "false"]).optional(),

    RESEND_API_KEY: z.string().optional(),

    // Outbound email (Nodemailer / SMTP)
    EMAIL_ADDRESS: z.string().email().optional(),
    EMAIL_PASSWORD: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_SECURE: z.enum(["true", "false"]).optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    SMTP_MAX_CONNECTIONS: z.coerce.number().optional(),
    SMTP_MAX_MESSAGES: z.coerce.number().optional(),
    SMTP_RATE_DELTA_MS: z.coerce.number().optional(),
    SMTP_RATE_LIMIT: z.coerce.number().optional(),
    SMTP_TLS_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).optional(),

    EMAIL_SEND_MAX_ATTEMPTS: z.coerce.number().optional(),
    EMAIL_SEND_RETRY_BASE_DELAY_MS: z.coerce.number().optional(),

    EMAIL_DAILY_LIMIT: z.coerce.number().optional(),

    BLOB_READ_WRITE_TOKEN: z.string().optional(),
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
    REDIS_TLS: process.env.REDIS_TLS,

    RESEND_API_KEY: process.env.RESEND_API_KEY,

    EMAIL_ADDRESS: process.env.EMAIL_ADDRESS,
    EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,

    SMTP_MAX_CONNECTIONS: process.env.SMTP_MAX_CONNECTIONS,
    SMTP_MAX_MESSAGES: process.env.SMTP_MAX_MESSAGES,
    SMTP_RATE_DELTA_MS: process.env.SMTP_RATE_DELTA_MS,
    SMTP_RATE_LIMIT: process.env.SMTP_RATE_LIMIT,
    SMTP_TLS_REJECT_UNAUTHORIZED: process.env.SMTP_TLS_REJECT_UNAUTHORIZED,

    EMAIL_SEND_MAX_ATTEMPTS: process.env.EMAIL_SEND_MAX_ATTEMPTS,
    EMAIL_SEND_RETRY_BASE_DELAY_MS: process.env.EMAIL_SEND_RETRY_BASE_DELAY_MS,

    EMAIL_DAILY_LIMIT: process.env.EMAIL_DAILY_LIMIT,

    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  },
});