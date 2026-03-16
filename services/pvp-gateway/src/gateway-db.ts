import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { db as appDb } from "../../../src/db";
import type * as schema from "../../../src/db/schema";

export const gatewayDb = appDb;

export type GatewayDb = NeonHttpDatabase<typeof schema>;
export type GatewayTx = Parameters<Parameters<GatewayDb["transaction"]>[0]>[0];
