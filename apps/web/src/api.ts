import { getToken } from "@clerk/react";
import type { z } from "zod";

/** A non-2xx response from the API. `status` is what callers branch on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`${path} returned ${status}`);
    this.name = "ApiError";
  }
}

/**
 * The one way the web app calls the API, and the only code that sets the
 * `Authorization` header (spec step 2, decision 12). Step 3's offline mutation
 * queue wraps this rather than re-implementing auth, so there is never a
 * second path that can disagree about it.
 *
 * Same origin: CloudFront's /api/* behaviour forwards to the Lambda, so there
 * is no CORS and no API hostname to configure.
 *
 * Clerk's standalone `getToken` waits for Clerk to load, returns a fresh token
 * (session tokens live 60 seconds; it refreshes them), and `null` when signed
 * out -- in which case the request goes without a header and the API decides.
 * Every response is validated against the shared schema the API produces.
 */
export async function apiFetch<T>(
  path: `/api/${string}`,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const token = await getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) throw new ApiError(response.status, path);
  return schema.parse(await response.json());
}
