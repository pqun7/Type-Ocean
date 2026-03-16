import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const hasValidDatabaseUrl = !!rawDatabaseUrl && /^postgres(?:ql)?:\/\//i.test(rawDatabaseUrl);
const databaseUrl = hasValidDatabaseUrl
  ? rawDatabaseUrl
  : "postgresql://user:password@localhost:5432/type_space";

if (!hasValidDatabaseUrl && process.env.NODE_ENV !== "test") {
  console.warn("[db] DATABASE_URL is missing or malformed; using a placeholder connection string during module initialization.");
}

const sql = neon(databaseUrl);

export const db = drizzle({ client: sql, schema });

export { schema };
