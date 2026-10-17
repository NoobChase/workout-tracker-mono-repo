import { defineConfig } from "drizzle-kit";

// `generate` needs no database. `migrate` reads DATABASE_URL, which must be a
// *direct* (non -pooler) connection string: PgBouncer in transaction mode
// breaks the session-level features the migrator relies on. Migrations reach
// dev and production from CI only.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
