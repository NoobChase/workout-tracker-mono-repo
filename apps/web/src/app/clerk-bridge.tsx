import { useAuth, useClerk, useUser } from "@clerk/react";
import { useEffect, useState } from "react";
import { notifyAuthChanged, registerClerk } from "../auth.js";
import { useDataLayer } from "../data/provider.js";

/**
 * Connects Clerk to the parts of the app that must not wait for it (design
 * D10). Renders nothing.
 *
 * - Hands the Clerk instance to `auth.ts`, so `apiFetch` and the queue can ask
 *   for a token without waiting for Clerk to load.
 * - Records the last signed-in user only when `clerk.status === "ready"`. In
 *   `degraded` mode the signed-in state comes from an unverified cookie, so
 *   nothing is written or cleared then; nothing else branches on it either.
 * - Tells the queue to flush when Clerk finishes loading or the user changes.
 */
export function ClerkBridge() {
  const layer = useDataLayer();
  const clerk = useClerk();
  const { isLoaded, userId } = useAuth();
  const { user } = useUser();
  const [status, setStatus] = useState<string>(clerk.status);
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  useEffect(() => {
    registerClerk(clerk);
    clerk.on("status", setStatus, { notify: true });
    return () => {
      clerk.off("status", setStatus);
      registerClerk(null);
    };
  }, [clerk]);

  useEffect(() => {
    notifyAuthChanged();
  }, [isLoaded, userId, status]);

  useEffect(() => {
    if (status !== "ready") return;
    const recorded = layer.lastUser.getSnapshot();
    if (userId) {
      if (recorded?.userId !== userId || recorded.email !== email) {
        void layer.signedIn({ userId, email });
      }
    } else if (recorded) {
      void layer.signedOut();
    }
  }, [layer, status, userId, email]);

  return null;
}
