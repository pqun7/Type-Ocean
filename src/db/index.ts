import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Pool } from "pg";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";

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

    // pg currently treats these modes as certificate verification, but will
    // weaken that behavior in its next major version. Make the intended secure
    // behavior explicit and avoid the runtime deprecation warning.
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
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

const isLocalPostgres = /^postgres(?:ql)?:\/\/(?:[^/@]+(?::[^/@]*)?@)?(?:localhost|127\.0\.0\.1|::1)(?::\d+)?(?:\/|$)/i.test(
  databaseUrl,
);

const neonDb = drizzle({ client: neon(databaseUrl), schema });

// The Neon HTTP driver is ideal for one-shot serverless queries, but Drizzle's
// callback-style `transaction()` API is intentionally unsupported by that
// driver. Keep a small, lazily connected PostgreSQL pool for the few workflows
// that require true transactions (for example, creating a user and profile
// atomically). Reuse the pool during local hot reloads to avoid leaking
// connections.
const globalForDatabase = globalThis as typeof globalThis & {
  __typeOceanTransactionPool?: Pool;
};

const transactionPool =
  globalForDatabase.__typeOceanTransactionPool ??
  new Pool({
    connectionString: databaseUrl,
    max: process.env.NODE_ENV === "production" ? 5 : 2,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.__typeOceanTransactionPool = transactionPool;
}

export const transactionDb = drizzleNodePostgres(transactionPool, { schema });

export const db = isLocalPostgres
  ? (transactionDb as unknown as typeof neonDb)
  : neonDb;

export { schema };
