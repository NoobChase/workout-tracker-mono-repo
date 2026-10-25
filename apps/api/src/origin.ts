import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * Set by CloudFront as an origin custom header on every `/api/*` request; a
 * viewer cannot supply it, because CloudFront overwrites a viewer header of
 * the same name. Must match `infra/lib/workout-tracker-stack.ts`.
 */
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

export interface OriginDeps {
  /** The shared secret CloudFront sends in `ORIGIN_VERIFY_HEADER`. */
  originVerifySecret(): Promise<string>;
}

/**
 * Refuses anything that did not come through CloudFront. The Function URL is
 * `AuthType: NONE` and so publicly addressable; this check is what keeps
 * CloudFront the only front door.
 *
 * Not CloudFront's origin access control: it signs the origin request with its
 * own `Authorization` header, which overwrites the viewer's `Bearer` token,
 * and Lambda refuses a signed request whose body is not hashed -- which no
 * webhook sender or MCP client will do. Runs before everything, the public
 * routes included.
 */
export function requireCloudFront(deps: OriginDeps): MiddlewareHandler {
  return async (c, next) => {
    const presented = c.req.header(ORIGIN_VERIFY_HEADER);
    if (!presented || !matches(presented, await deps.originVerifySecret())) {
      return c.json({ ok: false, error: "forbidden" }, 403);
    }
    await next();
  };
}

/** Constant-time; hashing first makes the lengths equal, as timingSafeEqual needs. */
function matches(presented: string, secret: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(presented), digest(secret));
}
