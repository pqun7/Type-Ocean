import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { db as appDb } from "../../../src/db/index";
import * as schema from "../../../src/db/schema";

// Required for @neondatabase/serverless Pool in Node.js (non-edge) environments.
neonConfig.webSocketConstructor = ws;

const gatewayDatabaseUrl = process.env.DATABASE_URL?.trim() ?? "";
export const isGatewayDbConfigured = /^postgres(?:ql)?:\/\//i.test(gatewayDatabaseUrl);
const configuredPoolMax = Number(process.env.PVP_DB_POOL_MAX ?? 20);
const gatewayPoolMax = Number.isFinite(configuredPoolMax) && configuredPoolMax > 0 ? Math.floor(configuredPoolMax) : 20;

const gatewayPool = isGatewayDbConfigured
	? new Pool({
			connectionString: gatewayDatabaseUrl,
			max: gatewayPoolMax,
			// Proactively close idle connections after 60 s so the pool never
			// hands out a connection that Neon has already reaped server-side.
			idleTimeoutMillis: 60_000,
		})
	: null;

export const gatewayDb = gatewayPool
	? drizzle({ client: gatewayPool, schema })
	: (appDb as unknown as GatewayDb);

export type GatewayDb = NeonDatabase<typeof schema>;
export type GatewayTx = Parameters<Parameters<GatewayDb["transaction"]>[0]>[0];

/**
 * Runs work in a DB transaction using the gateway pool-backed driver.
 */
export async function runGatewayTransaction<T>(db: GatewayDb, run: (tx: GatewayTx) => Promise<T>) {
	return db.transaction(async (tx) => run(tx));
}

// ---------------------------------------------------------------------------
// Retry helper for transient Neon connection terminations
// ---------------------------------------------------------------------------

function isRetriableDbError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	if (
		msg.includes("connection terminated") ||
		msg.includes("connection closed") ||
		msg.includes("connection reset")
	)
		return true;
	// Walk the cause chain — drizzle wraps the pg error under .cause
	if (err.cause != null) return isRetriableDbError(err.cause);
	return false;
}

/**
 * Retries a DB operation on transient Neon connection-terminated errors.
 * The pool discards the dead connection and opens a fresh one on the next
 * attempt, so a single retry is usually sufficient.
 */
export async function withDbRetry<T>(op: () => Promise<T>, attempts = 2): Promise<T> {
	let lastError: unknown;
	for (let i = 0; i <= attempts; i++) {
		try {
			return await op();
		} catch (err) {
			lastError = err;
			if (!isRetriableDbError(err) || i >= attempts) throw err;
			await new Promise<void>((resolve) => setTimeout(resolve, 200 * (i + 1)));
		}
	}
	throw lastError;
}
