import {
  isPro,
  type ResolvedUser,
  type SubStatus,
  type UserId,
} from "@workout-tracker/db";
import type { MiddlewareHandler } from "hono";

/** The resolved internal user, set by `requireAuth` for everything after it. */
export interface AuthedUser {
  /** `users.id` -- pass it to `userScope`; never the Clerk id. */
  id: UserId;
  subStatus: SubStatus;
}

export interface AuthEnv {
  Variables: { user: AuthedUser };
}

export interface AuthDeps {
  /**
   * Verifies a Clerk session token and returns its `sub` (the Clerk user id).
   * Rejects on any invalid token. Never keyed on email: emails change and are
   * not unique across identity providers.
   */
  verifySessionToken(token: string): Promise<string>;
  resolveUser(clerkUserId: string): Promise<ResolvedUser>;
}

/**
 * Billing is not wired until build step 5, so everyone is entitled until then.
 * A constant here rather than a `sub_status` value: `'NONE'` is the true
 * pre-Stripe value, and filling the column with fiction would leave step 5's
 * webhook unable to reconcile it (spec step 2, decision 4). Not an env var
 * either -- scaffolding with a deletion date should not look like a knob.
 */
const BILLING_NOT_LIVE = true; // DELETE IN STEP 5

const unauthorized = { ok: false, error: "unauthorized" } as const;

/**
 * Verifies the bearer token and resolves it to a `users` row, creating the row
 * on first sight (operations.md 1.1). Every failure is the same bare 401: the
 * caller learns nothing about *why*, and the reason goes to the log instead.
 */
export function requireAuth(deps: AuthDeps): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = /^Bearer (\S+)$/.exec(
      c.req.header("Authorization") ?? "",
    )?.[1];
    if (!token) return c.json(unauthorized, 401);

    let clerkUserId: string;
    try {
      clerkUserId = await deps.verifySessionToken(token);
    } catch (err) {
      console.warn("session token rejected", err);
      return c.json(unauthorized, 401);
    }

    const user = await deps.resolveUser(clerkUserId);
    // Defence in depth: Clerk has already destroyed a deleted user's identity,
    // so a valid token for one should not exist (data-model.md 4). Costs
    // nothing not to depend on that.
    if (user.deletedAt) return c.json(unauthorized, 401);

    c.set("user", { id: user.id, subStatus: user.subStatus });
    await next();
  };
}

/**
 * Gates the Pro route groups -- progression analytics and MCP tools, nothing
 * else (data-model.md 3.8). Reads the `sub_status` `requireAuth` just loaded,
 * so it costs no query. `bypass` exists so tests can exercise the real rule
 * while billing is not live; production code never passes it.
 */
export function requirePro({
  bypass = BILLING_NOT_LIVE,
}: { bypass?: boolean } = {}): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (!bypass && !isPro(c.get("user").subStatus)) {
      return c.json({ ok: false, error: "pro subscription required" }, 403);
    }
    await next();
  };
}
