import {
  healthResponseSchema,
  meResponseSchema,
  type HealthResponse,
  type ErrorResponse,
  type MeResponse,
} from "@workout-tracker/shared";
import { ServiceError, type ServiceErrorKind } from "@workout-tracker/services";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { except } from "hono/combine";
import {
  requireAuth,
  requirePro,
  type AuthDeps,
  type AuthEnv,
} from "./auth.js";
import { catalogRoutes } from "./catalog.js";
import { requireCloudFront, type OriginDeps } from "./origin.js";
import { programRoutes } from "./programs.js";
import type { ApiDeps } from "./services.js";
import { trainingRoutes } from "./training.js";
import { clerkWebhooks, type WebhookDeps } from "./webhooks.js";

export interface AppDeps extends OriginDeps, AuthDeps, WebhookDeps, ApiDeps {
  /** `select now(), version()` for the health route. */
  databaseHealth(): Promise<{ now: Date; version: string }>;
}

/**
 * The only routes reachable without a session token. Everything else is behind
 * `requireAuth` by default, so a route added later is authenticated unless
 * someone deliberately lists it here -- failing closed, not open. An unknown
 * path therefore answers 401, not 404, to a signed-out caller.
 */
const PUBLIC_PATHS = ["/api/hello", "/api/webhooks/clerk"];

/** How each service failure reads on the wire (services/CLAUDE.md). */
const SERVICE_ERROR_STATUS: Record<ServiceErrorKind, ContentfulStatusCode> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  forbidden: 403,
};

export interface AppOptions {
  /**
   * Overrides `requirePro`'s billing bypass. Production never passes it, so it
   * stays `BILLING_NOT_LIVE` until step 5 deletes both; tests pass `false` to
   * exercise the real entitlement rule.
   */
  proBypass?: boolean;
}

/**
 * True until the first request this execution environment serves. Cheap proof
 * that the pool really is being reused rather than rebuilt per invocation.
 */
let coldStart = true;

export function createApp(
  deps: AppDeps,
  options: AppOptions = {},
): Hono<AuthEnv> {
  // CloudFront forwards the full path, so the Lambda sees `/api/...` and the
  // routes are declared with that prefix rather than stripped at the edge.
  const app = new Hono<AuthEnv>().basePath("/api");

  // Order matters: nothing -- not even the public routes -- runs for a
  // request that did not come through CloudFront.
  app.use("*", requireCloudFront(deps));
  app.use("*", except(PUBLIC_PATHS, requireAuth(deps)));

  app.get("/hello", async (c) => {
    const isColdStart = coldStart;
    coldStart = false;

    const { now, version } = await deps.databaseHealth();
    const body: HealthResponse = {
      ok: true,
      message: "hello from workout-tracker",
      databaseTime: now.toISOString(),
      databaseVersion: version.split(" ").slice(0, 2).join(" "),
      coldStart: isColdStart,
    };

    // Validated on the way out as well as on the way in, so the shared schema
    // is load-bearing rather than decorative.
    return c.json(healthResponseSchema.parse(body));
  });

  app.route("/webhooks", clerkWebhooks(deps));

  app.get("/me", (c) => {
    const user = c.get("user");
    const body: MeResponse = {
      ok: true,
      userId: user.id,
      subStatus: user.subStatus,
    };
    return c.json(meResponseSchema.parse(body));
  });

  // Progression analytics (data-model.md 3.8): the first of the two Pro route
  // groups. No routes yet -- they arrive with step 4's queries -- but the gate
  // is mounted now so nothing under this prefix can ship ungated.
  app.use("/analytics/*", requirePro({ bypass: options.proBypass }));

  // The plan and the sessions: reads are authenticated, writes also Pro.
  app.route("/", trainingRoutes(deps, options));
  app.route("/", catalogRoutes(deps, options));
  app.route("/", programRoutes(deps, options));

  app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));

  app.onError((err, c) => {
    // A refusal the lifter can act on: its message is written to be shown.
    if (err instanceof ServiceError) {
      const body: ErrorResponse = { ok: false, error: err.message };
      return c.json(body, SERVICE_ERROR_STATUS[err.kind]);
    }
    // Anything else is a server fault. 500 is what the offline queue retries.
    console.error("unhandled error", err);
    return c.json({ ok: false, error: "internal server error" }, 500);
  });

  return app;
}
