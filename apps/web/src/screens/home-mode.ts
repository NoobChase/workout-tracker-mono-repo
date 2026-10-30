import type { NextView } from "../data/hooks.js";

/** What home's left column shows (brief `apps-web-src-home`). */
export type HomeMode =
  "loading" | "train" | "first-run" | "idle" | "error" | "offline";

/**
 * Home's state from what's next and the program list. Anything to train
 * wins; with nothing, the program list says whether this lifter has no
 * programs at all (first run) or none active (idle); without it, a failed
 * what's-next read is an error, no signal is offline, and a failed list is
 * an error too.
 */
export function homeMode({
  next,
  programs,
  online,
  authReady,
}: {
  next: Pick<
    NextView,
    "next" | "inProgress" | "waiting" | "source" | "isLoading" | "error"
  >;
  programs: { data?: { programs: readonly unknown[] }; error: Error | null };
  online: boolean;
  /** Clerk has a session, so the server reads can run. */
  authReady: boolean;
}): HomeMode {
  if (next.isLoading) return "loading";
  // Online with nothing yet, and the reads waiting on sign-in to load.
  if (next.source === "none" && !next.error && online && !authReady) {
    return "loading";
  }
  if (next.next.length + next.inProgress.length + next.waiting.length > 0) {
    return "train";
  }
  if (programs.data) {
    return programs.data.programs.length === 0 ? "first-run" : "idle";
  }
  if (next.source === "none" && next.error) return "error";
  if (!online) return "offline";
  if (programs.error) return "error";
  return "loading";
}
