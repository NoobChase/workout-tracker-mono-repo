import { verifyToken } from "@clerk/backend";
import { resolveUser, softDeleteUser } from "@workout-tracker/db";
import type { AppDeps } from "./app.js";
import { getDb, getPool } from "./db.js";
import { getSecureParameter, requireEnv } from "./ssm.js";

/**
 * Origins a session token may have been minted for -- Clerk's `azp` claim.
 * Comes from CDK, which derives it from the one place the domain is written
 * down, so it cannot drift from the infrastructure (spec step 2, decision 2).
 * An empty list would disable the check, so that refuses to start instead.
 */
function authorizedParties(): string[] {
  const parties = requireEnv("CLERK_AUTHORIZED_PARTIES")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parties.length === 0) {
    throw new Error("CLERK_AUTHORIZED_PARTIES lists no origins");
  }
  return parties;
}

export function productionDeps(): AppDeps {
  const parties = authorizedParties();
  const secretKeyParameter = requireEnv("CLERK_SECRET_KEY_PARAMETER_NAME");
  const webhookSecretParameter = requireEnv(
    "CLERK_WEBHOOK_SIGNING_SECRET_PARAMETER_NAME",
  );

  return {
    // `verifyToken`, not `authenticateRequest`: the latter is for SSR apps
    // doing handshake redirects (decision 1). With `secretKey` it fetches the
    // JWKS from Clerk and caches it at module scope, refetching on an unknown
    // `kid` -- so a key rotation needs no manual step, and the request path
    // never waits on Clerk. Throws on a bad signature, an expired token or a
    // foreign `azp`.
    async verifySessionToken(token) {
      const { sub } = await verifyToken(token, {
        secretKey: await getSecureParameter(secretKeyParameter),
        authorizedParties: parties,
      });
      return sub;
    },

    async resolveUser(clerkUserId) {
      return resolveUser(await getDb(), clerkUserId);
    },

    async softDeleteUser(clerkUserId) {
      return softDeleteUser(await getDb(), clerkUserId);
    },

    clerkWebhookSigningSecret: () => getSecureParameter(webhookSecretParameter),

    async databaseHealth() {
      const pool = await getPool();
      const { rows } = await pool.query<{ now: Date; version: string }>(
        "select now() as now, version() as version",
      );
      const row = rows[0];
      if (!row) {
        throw new Error("select now() returned no rows");
      }
      return row;
    },
  };
}
