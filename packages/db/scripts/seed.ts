// `npm run seed -w @workout-tracker/db` -- CI runs this after `migrate`, with
// the same direct connection string. Never by hand against dev or production
// (spec step 2, decision 8).
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { catalog } from "../src/catalog";
import { createDb } from "../src/client";
import { seedCatalog } from "../src/seed";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({ connectionString });
try {
  const summary = await createDb(pool).transaction((tx) =>
    seedCatalog(tx, catalog),
  );
  console.log(`catalog: ${catalog.length} exercises`, summary);
} finally {
  await pool.end();
}
