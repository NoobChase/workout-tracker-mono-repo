import { ServiceError } from "@workout-tracker/services";
import type { Context } from "hono";
import type { z } from "zod";
import type { AuthEnv } from "./auth.js";
import type { ApiDeps } from "./services.js";

/**
 * The service call's first two arguments, `(db, user)`, from the
 * authenticated request. `user` is `users.id`, never the Clerk id.
 */
export function callerOf(deps: Pick<ApiDeps, "database">) {
  return async (c: Context<AuthEnv>) =>
    [await deps.database(), c.get("user").id] as const;
}

/**
 * Validation failures are `invalid` ServiceErrors so they take the same road
 * to a 400 as the service layer's own refusals. The message names the first
 * problem and is safe to show the lifter as written.
 */
export function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  label = "request",
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  throw new ServiceError(
    "invalid",
    `Invalid ${label}${where}: ${issue?.message ?? "not valid"}.`,
  );
}

/** The request body as JSON; a missing or malformed body is a 400. */
export async function json(c: Context<AuthEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ServiceError("invalid", "The request body must be JSON.");
  }
}
