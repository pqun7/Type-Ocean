import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// Database access policy:
// - Never import or use any legacy ORM client directly in this repository.
// - Use this exported `db` instance for all DB operations.
// - Prefer `db.query.*` for relational fetches and `db.select().from()` for custom queries.

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const hasValidDatabaseUrl = !!rawDatabaseUrl && /^postgres(?:ql)?:\/\//i.test(rawDatabaseUrl);
const databaseUrl = hasValidDatabaseUrl
  ? rawDatabaseUrl
  : "postgresql://user:password@localhost:5432/type_space";

export const isDatabaseConfigured = hasValidDatabaseUrl;

if (!hasValidDatabaseUrl && process.env.NODE_ENV !== "test") {
  console.warn("[db] DATABASE_URL is missing or malformed; using a placeholder connection string during module initialization.");
}

const sql = neon(databaseUrl);

export const db = drizzle({ client: sql, schema });

export { schema };
