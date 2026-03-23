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
