import { errorResponse } from "@workout-tracker/shared";
import type { z } from "zod";
import { getAuthToken } from "./auth.js";

export { AuthNotReadyError, OfflineError } from "./auth.js";

export type ApiPath = `/api/${string}`;

/**
 * A non-2xx response from the API. `status` is what callers branch on;
 * `reason` is the server's `{ ok: false, error }` message, written to be shown
 * to the lifter verbatim, when the body carried one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly reason: string | null,
  ) {
    super(reason ?? `${path} returned ${status}`);
    this.name = "ApiError";
  }
}

/** `fetch` itself failed: no route to the API, though the browser says online. */
export class NetworkError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`Couldn't reach the server (${path})`, { cause });
    this.name = "NetworkError";
  }
}

export interface ApiInit {
  method?: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
  /** Sent as JSON. Already validated against its `packages/shared` schema. */
  body?: unknown;
  /** Ask Clerk for a fresh token instead of a cached one (after a `401`). */
  refreshToken?: boolean;
  signal?: AbortSignal;
}

/**
 * The one way the web app calls the API, and the only code that sets the
 * `Authorization` header. Screens read through `apiFetch`; the offline
 * mutation queue sends through `apiRequest`. Neither waits for Clerk to load
 * (design D10): the token comes from `getAuthToken`, which throws
 * `OfflineError` or `AuthNotReadyError` instead.
 *
 * Same origin: CloudFront's /api/* behaviour forwards to the Lambda, so there
 * is no CORS and no API hostname to configure. A signed-out caller sends no
 * header and the API decides.
 */
export async function apiRequest(
  path: ApiPath,
  init: ApiInit = {},
): Promise<Response> {
  const token = await getAuthToken({ skipCache: init.refreshToken });
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new NetworkError(path, error);
  }
  if (!response.ok) {
    throw new ApiError(response.status, path, await readReason(response));
  }
  return response;
}

/** `apiRequest`, then the body validated against the shared response schema. */
export async function apiFetch<T>(
  path: ApiPath,
  schema: z.ZodType<T>,
  init: ApiInit = {},
): Promise<T> {
  const response = await apiRequest(path, init);
  return schema.parse(await response.json());
}

async function readReason(response: Response): Promise<string | null> {
  try {
    const parsed = errorResponse.safeParse(await response.json());
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}
