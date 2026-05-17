import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// Database access policy:
// - Never import or use any legacy ORM client directly in this repository.
// - Use this exported `db` instance for all DB operations.
// - Prefer `db.query.*` for relational fetches and `db.select().from()` for custom queries.

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const hasValidDatabaseUrl = !!rawDatabaseUrl && /^postgres(?:ql)?:\/\//i.test(rawDatabaseUrl);

// Append statement_timeout if not already present so runaway queries are
// killed by PostgreSQL after 8 seconds instead of hanging indefinitely.
function withStatementTimeout(url: string, ms = 8_000): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("options")) {
      parsed.searchParams.set("options", `-c statement_timeout=${ms}`);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const databaseUrl = hasValidDatabaseUrl
  ? withStatementTimeout(rawDatabaseUrl!)
  : "postgresql://user:password@localhost:5432/type_space";

export const isDatabaseConfigured = hasValidDatabaseUrl;

if (!hasValidDatabaseUrl && process.env.NODE_ENV !== "test") {
  console.warn("[db] DATABASE_URL is missing or malformed; using a placeholder connection string during module initialization.");
}

const sql = neon(databaseUrl);

export const db = drizzle({ client: sql, schema });

export { schema };
