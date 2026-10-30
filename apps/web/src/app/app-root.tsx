import { Clerk } from "@clerk/clerk-js";
import { ClerkProvider, useAuth } from "@clerk/react";
import { ui } from "@clerk/ui";
import { useEffect, useState } from "react";
import { App } from "../App.js";
import type { AppRootProps } from "../boot/shell.js";
import { createQueryClient, DataProvider } from "../data/provider.js";
import { httpApi, httpTransport } from "../local/http.js";
import { onLocalDbEvent } from "../local/db.js";
import { createDataLayer, type DataLayer } from "../local/layer.js";
import { UpgradeBlocked } from "../boot/upgrade-blocked.js";
import { clerkNavigation } from "./clerk-navigation.js";

/*
 * The app chunk's entry (design D2): Clerk, the data layer and the router.
 * The bootstrap (`main.tsx`) imports it straight away on a device someone has
 * signed in on, and behind the landing page otherwise.
 */

// Per stage, like the API's secret key: a production build carries the
// production instance's key (.env.production), and the two instances sign
// with different keys, so a mismatched pair fails verification in the API.
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set for this build");
}

/**
 * One data layer and one query client per page, however often React mounts
 * (StrictMode mounts twice in development): the layer owns the queue's one
 * flusher.
 */
let layer: Promise<DataLayer> | null = null;
const openDataLayer = () =>
  (layer ??= createDataLayer({ api: httpApi, transport: httpTransport }));
let queryClient: ReturnType<typeof createQueryClient> | null = null;
const getQueryClient = () => (queryClient ??= createQueryClient());

/**
 * Clerk is bundled (`@clerk/clerk-js` and its UI), never fetched from Clerk's
 * CDN, and never awaited (design D10): an offline cold start still loads it,
 * and the app renders from the device's data while Clerk catches up. It
 * stays mounted when the landing page hands over, so the instance that
 * checked for a session is the one the app uses.
 */
export function AppRoot({ active, onSignedIn }: AppRootProps) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      Clerk={Clerk}
      ui={ui}
      routerPush={clerkNavigation.push}
      routerReplace={clerkNavigation.replace}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
    >
      {active ? <AppWithData /> : <SessionProbe onSignedIn={onSignedIn} />}
    </ClerkProvider>
  );
}

/** Behind the landing page: tells the bootstrap when Clerk has a session. */
function SessionProbe({ onSignedIn }: { onSignedIn: () => void }) {
  const { isSignedIn } = useAuth();
  useEffect(() => {
    if (isSignedIn) onSignedIn();
  }, [isSignedIn, onSignedIn]);
  return null;
}

/** IndexedDB first (milliseconds, no network), then the app. */
function AppWithData() {
  const [state, setState] = useState<
    { layer: DataLayer } | { error: true } | { blocked: true } | null
  >(null);

  useEffect(() => {
    let current = true;
    // Held up by an older version open in another tab: say so; the open
    // carries on by itself once that tab goes.
    const offBlocked = onLocalDbEvent((event) => {
      if (event.kind === "blocked" && current) setState({ blocked: true });
    });
    openDataLayer().then(
      (opened) => current && setState({ layer: opened }),
      (error: unknown) => {
        console.error(error);
        if (current) setState({ error: true });
      },
    );
    return () => {
      current = false;
      offBlocked();
    };
  }, []);

  if (!state) return null;
  if ("blocked" in state) return <UpgradeBlocked />;
  if ("error" in state) {
    // Private browsing in some browsers has no IndexedDB. Logging offline
    // can't work without it, so say so rather than render a broken app.
    return (
      <p className="mx-auto max-w-[30rem] px-4 pt-16 text-[17px]">
        Tanren needs on-device storage to keep your sets safe, and this browser
        didn’t allow it. Try leaving private browsing.
      </p>
    );
  }
  return (
    <DataProvider layer={state.layer} queryClient={getQueryClient()}>
      <App />
    </DataProvider>
  );
}
