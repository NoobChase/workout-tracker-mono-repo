import { z } from "zod";

/**
 * Step 1 only: the shape the hello-world route returns, proving the whole pipe
 * (CloudFront -> Lambda Function URL -> Hono -> Neon) end to end. It lives here
 * rather than in `apps/api` so the web app validates the same contract the API
 * produces -- the shared-schema arrangement the whole repo layout exists for.
 */
export const healthResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Result of `select now()` against Neon, as an ISO-8601 string. */
  databaseTime: z.iso.datetime({ offset: true }),
  /** Postgres `version()`, trimmed to its first token pair (e.g. "PostgreSQL 17.5"). */
  databaseVersion: z.string(),
  /** True when this request was served by a freshly started execution environment. */
  coldStart: z.boolean(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
