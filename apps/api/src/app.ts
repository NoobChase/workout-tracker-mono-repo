import {
  healthResponseSchema,
  type HealthResponse,
} from "@workout-tracker/shared";
import { Hono } from "hono";
import { getPool } from "./db.js";

/**
 * True until the first request this execution environment serves. Cheap proof
 * that the pool really is being reused rather than rebuilt per invocation.
 */
let coldStart = true;

// CloudFront forwards the full path, so the Lambda sees `/api/...` and the
// routes are declared with that prefix rather than stripped at the edge.
export const app = new Hono().basePath("/api");

app.get("/hello", async (c) => {
  const isColdStart = coldStart;
  coldStart = false;

  const pool = await getPool();
  const { rows } = await pool.query<{ now: Date; version: string }>(
    "select now() as now, version() as version",
  );

  const row = rows[0];
  if (!row) {
    throw new Error("select now() returned no rows");
  }

  const body: HealthResponse = {
    ok: true,
    message: "hello from workout-tracker",
    databaseTime: row.now.toISOString(),
    databaseVersion: row.version.split(" ").slice(0, 2).join(" "),
    coldStart: isColdStart,
  };

  // Validated on the way out as well as on the way in: this is the one route
  // that exists, so it may as well prove the shared schema is load-bearing.
  return c.json(healthResponseSchema.parse(body));
});

app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));

app.onError((err, c) => {
  console.error("unhandled error", err);
  return c.json({ ok: false, error: "internal server error" }, 500);
});
