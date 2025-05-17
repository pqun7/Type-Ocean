import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    AUTH_GITHUB_ID: z.string().min(1),
    AUTH_GITHUB_SECRET: z.string().min(1),
    AUTH_SECRET: z.string().min(32),
    DATABASE_URL: z.string().url(),
    SESSION_MAX_AGE: z.coerce.number().default(2592000), // 30 days
  },
  client: {},
  runtimeEnv: {
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_MAX_AGE: process.env.SESSION_MAX_AGE,
  },
});