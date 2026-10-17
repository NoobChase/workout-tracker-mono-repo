import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Run tests through `npm test`, which creates a Neon branch for the run.",
  );
}

export const pool = new Pool({ connectionString });

/**
 * Runs `fn` inside a transaction that is always rolled back, so tests share one
 * migrated branch without seeing each other's rows. Deferred constraints are
 * only checked at COMMIT, which never happens here -- a test that relies on one
 * must `SET CONSTRAINTS ALL IMMEDIATE` to force the check.
 */
export async function inRolledBackTransaction(
  fn: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
