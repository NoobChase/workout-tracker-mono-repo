import { ApiError, NetworkError, OfflineError } from "../api.js";
import { AuthNotReadyError } from "../auth.js";
import { LocalSessionError } from "../local/sessions.js";

/** A lapsed or unentitled account (requirePro answers 402 or 403). */
export function isNotEntitled(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 402 || error.status === 403)
  );
}

/**
 * Words for an error the lifter sees: the server's own reason when it gave
 * one, the local layer's message as written, and plain words for the network.
 */
export function errorText(
  error: unknown,
  doing: "start" | "continue" = "start",
): string {
  // No account known on this device yet (Clerk hasn't loaded and nobody was
  // recorded): say it plainly, in terms of what the lifter was doing.
  if (error instanceof LocalSessionError && error.code === "not-signed-in") {
    return doing === "start"
      ? error.message
      : "Sign in to continue this workout, so your sets are saved to your account.";
  }
  if (error instanceof LocalSessionError) return error.message;
  if (error instanceof OfflineError) return "There's no signal right now.";
  if (error instanceof AuthNotReadyError) {
    return "Sign-in is still loading. Try again in a moment.";
  }
  if (error instanceof NetworkError) {
    return "Couldn't reach Tanren's server. Check the connection and try again.";
  }
  if (error instanceof ApiError) {
    if (error.status === 404) return "That isn't in your account.";
    return error.reason ?? `The server answered ${error.status}.`;
  }
  return error instanceof Error ? error.message : String(error);
}
