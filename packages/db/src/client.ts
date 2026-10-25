import type { Pool, PoolClient } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema>;

/**
 * Wraps a WebSocket `Pool` -- never the HTTP driver, which cannot run the
 * interactive transactions step 4's clone primitive needs. The caller owns the
 * pool's lifetime: build it once per execution environment, never per request.
 * A single checked-out `PoolClient` works too, which is how the integration
 * tests run inside one rolled-back transaction.
 */
export function createDb(client: Pool | PoolClient): Db {
  return drizzle({ client, schema });
}
