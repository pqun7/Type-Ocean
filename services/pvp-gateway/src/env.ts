import { z } from "zod";
import { config } from "dotenv";
import path from "path";

// Load gateway-specific .env or fallback to root
config({ path: path.resolve(process.cwd(), ".env.gateway.local") });
config({ path: path.resolve(process.cwd(), ".env.gateway") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

const gatewayEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8787),
  
  // Database
  DATABASE_URL: z.string().url(),
  PVP_DB_POOL_MAX: z.coerce.number().default(20),
  
  // Redis
  PVP_REDIS_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(), // Fallback
  PVP_USE_REDIS: z.coerce.number().default(1),
  
  // Secrets (Primary + Previous for rotation)
  PVP_GATEWAY_JWT_SECRET: z.string().min(32),
  PVP_GATEWAY_JWT_SECRET_PREVIOUS: z.string().min(32).optional(),
  
  // Security
  PVP_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  PVP_TRUST_PROXY_TLS: z.coerce.number().default(0),
  
  // Rate Limiting
  PVP_API_WS_TOKEN_LIMIT: z.coerce.number().default(30),
  PVP_WS_MAX_CONNECTIONS_PER_IP: z.coerce.number().default(5),
  
  // Internal
  INTERNAL_STATS_SECRET: z.string().optional(),
  STATS_PROCESSOR_URL: z.string().url().optional(),
});

const _env = gatewayEnvSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid PvP Gateway environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;

// Guard: PVP_INSECURE_LOCALHOST must never be enabled in production.
if (process.env.PVP_INSECURE_LOCALHOST === "1" && env.NODE_ENV === "production") {
  console.error(
    "❌ PVP_INSECURE_LOCALHOST=1 is not allowed in production. " +
    "Remove this environment variable before deploying."
  );
  process.exit(1);
}
