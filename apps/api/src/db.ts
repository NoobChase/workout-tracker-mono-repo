import { Pool, neonConfig } from "@neondatabase/serverless";
import { createDb, type Db } from "@workout-tracker/db";
import ws from "ws";
import { getSecureParameter, requireEnv } from "./secrets.js";

// The WebSocket driver, not the HTTP one. The HTTP driver cannot do interactive
// transactions, and the clone primitive (operations.md 0.2), copy-program (3.9),
// activate (3.10) and finish-and-maybe-extend (4.13) all read a level and then
// write the next one using what they read. Choosing HTTP here would surface as a
// wall at step 4, not here.
neonConfig.webSocketConstructor = ws;

/**
 * Memoised at module scope, so the pool is built once per execution
 * environment rather than once per request. The promise is what gets cached,
 * so concurrent first requests share one construction.
 */
let poolPromise: Promise<Pool> | undefined;
let dbPromise: Promise<Db> | undefined;

export function getPool(): Promise<Pool> {
  if (!poolPromise) {
    poolPromise = createPool();
    // A failed build (SSM throttled, a bad parameter) is retried by the next
    // request rather than cached for the life of the environment.
    poolPromise.catch(() => (poolPromise = dbPromise = undefined));
  }
  return poolPromise;
}

export function getDb(): Promise<Db> {
  dbPromise ??= getPool().then(createDb);
  return dbPromise;
}

async function createPool(): Promise<Pool> {
  const parameterName = requireEnv("DATABASE_URL_PARAMETER_NAME");
  const connectionString = await getSecureParameter(parameterName);

  // Pooled (-pooler) endpoint: this is the runtime. The direct endpoint is for
  // CI migrations only, and this role cannot read that parameter.
  if (!connectionString.includes("-pooler.")) {
    throw new Error(
      `SSM parameter ${parameterName} does not point at a Neon pooled (-pooler) endpoint`,
    );
  }

  // Never `pool.end()` per request -- the point of building it out here is that
  // it survives across invocations of the same execution environment.
  return new Pool({ connectionString });
}
