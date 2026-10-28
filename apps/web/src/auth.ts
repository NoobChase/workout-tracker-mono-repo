/**
 * The app's one handle on Clerk outside React (design D10).
 *
 * `ClerkBridge` registers the Clerk instance here once `ClerkProvider` has
 * one. Nothing in this module waits for Clerk: before it has loaded, a token
 * request fails at once with `AuthNotReadyError`, so neither a screen read nor
 * the mutation queue can hang on a Clerk that may take 14s to reach
 * `degraded` offline. It never calls `getToken()` while `navigator.onLine` is
 * false, and it turns Clerk's own `clerk_offline` error into `OfflineError`.
 * Both are retries for the queue (D7).
 */

/** The parts of a Clerk instance this module reads. `useClerk()` satisfies it. */
export interface ClerkHandle {
  readonly loaded: boolean;
  readonly status: string;
  readonly session?: {
    getToken(options?: { skipCache?: boolean }): Promise<string | null>;
  } | null;
  readonly user?: { readonly id: string } | null;
}

/** No signal: the browser reports offline, or Clerk could not reach its API. */
export class OfflineError extends Error {
  constructor(message = "No connection") {
    super(message);
    this.name = "OfflineError";
  }
}

/** Clerk has not finished loading. Callers retry later; nothing waited. */
export class AuthNotReadyError extends Error {
  constructor() {
    super("Sign-in is still loading");
    this.name = "AuthNotReadyError";
  }
}

let clerk: ClerkHandle | null = null;
const listeners = new Set<() => void>();

export function registerClerk(handle: ClerkHandle | null): void {
  clerk = handle;
  notifyAuthChanged();
}

/** Called by `ClerkBridge` whenever Clerk's loaded state or user changes. */
export function notifyAuthChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once Clerk has loaded (`ready` or `degraded`) with a session. */
export function isAuthReady(): boolean {
  return Boolean(clerk?.loaded && clerk.session);
}

/** The signed-in Clerk user, or `undefined` while Clerk is still loading. */
export function currentClerkUserId(): string | null | undefined {
  if (!clerk?.loaded) return undefined;
  return clerk.user?.id ?? null;
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * A session token for one API call, or `null` when signed out. `skipCache`
 * forces a fresh token: the queue's answer to a `401`, since tokens expire
 * while a phone is offline. Throws `OfflineError` or `AuthNotReadyError`
 * rather than waiting.
 */
export async function getAuthToken(
  options: { skipCache?: boolean } = {},
): Promise<string | null> {
  if (!isOnline()) throw new OfflineError();
  if (!clerk?.loaded) throw new AuthNotReadyError();
  const session = clerk.session;
  if (!session) return null;
  try {
    return await session.getToken(
      options.skipCache ? { skipCache: true } : undefined,
    );
  } catch (error) {
    if (isClerkOffline(error)) throw new OfflineError("Sign-in has no signal");
    throw error;
  }
}

function isClerkOffline(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "clerk_offline"
  );
}
