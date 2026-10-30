import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { hasLastUser } from "./boot/last-user-hint.js";
import { Shell, type AppModule } from "./boot/shell.js";
import { UpgradeBlocked } from "./boot/upgrade-blocked.js";
import { updates } from "./boot/updates.js";
import { onLocalDbEvent } from "./local/db.js";
import "./index.css";

/*
 * The bootstrap (design D2). It stays small: React, the tokens, and one
 * IndexedDB read. Everything else is a chunk it picks:
 *
 * - the landing page (`landing/`): no Clerk, no data layer, for a visitor at
 *   `/` on a device nobody has signed in on, and for everyone at `/about`
 *   (signed in, by the device record, its calls to action read "Open app");
 * - the app (`app/app-root.tsx`): Clerk, the data layer and the router, for
 *   everyone else, and for the landing page's calls to action.
 *
 * The service worker precaches every chunk, so either works offline. The
 * bootstrap registers it once for both (`boot/updates.ts`, design D18).
 */

const element = document.getElementById("root");
if (!element) {
  throw new Error("#root is missing from index.html");
}
const root = createRoot(element);

function render(node: ReactNode) {
  root.render(<StrictMode>{node}</StrictMode>);
}

const loadApp = (): Promise<AppModule> => import("./app/app-root.js");

// The design kit at /design exists in development only. `import.meta.env.DEV`
// is the literal `false` in a production build, so this branch and the kit's
// chunk are dropped from the bundle entirely. It sits outside the router.
if (
  import.meta.env.DEV &&
  window.location.pathname.replace(/\/$/, "") === "/design"
) {
  void import("./design/kit.js").then(({ DesignKit }) => {
    render(<DesignKit />);
  });
} else {
  void boot();
}

/**
 * The bootstrap's storage read, saying so if it waits on an older version
 * open in another tab (it carries on once that tab goes; whatever renders
 * next replaces the notice). The app chunk explains its own open.
 */
async function sayIfBlocked<T>(work: Promise<T>): Promise<T> {
  const off = onLocalDbEvent((event) => {
    if (event.kind === "blocked") render(<UpgradeBlocked />);
  });
  try {
    return await work;
  } finally {
    off();
  }
}

async function boot() {
  // One registration for whichever chunk shows (design D18). A public page
  // takes a new version at once; the app sets its own context once it knows
  // where it is and whether a workout is in progress.
  updates.start();
  try {
    const path = window.location.pathname.replace(/(.)\/$/, "$1");
    const about = path === "/about";
    // The device record only decides the two landing paths; every other
    // path is the app's (its gate sends a signed-out visitor to sign in).
    const signedIn =
      about || path === "/" ? await sayIfBlocked(hasLastUser()) : null;
    if (about || signedIn === false) {
      updates.setContext({ page: "public" });
      const { Landing } = await import("./landing/landing.js");
      render(
        <Shell
          Landing={Landing}
          app={null}
          loadApp={loadApp}
          about={about}
          signedIn={signedIn === true}
        />,
      );
    } else {
      render(<Shell Landing={null} app={await loadApp()} loadApp={loadApp} />);
    }
  } catch (error) {
    // A chunk that didn't arrive: a first visit with no connection (no
    // service worker yet), or a deploy that replaced it mid-visit.
    console.error(error);
    render(
      <p className="mx-auto max-w-[30rem] px-4 pt-16 text-[17px]">
        Tanren didn’t finish loading. Check your connection, then reload the
        page.
      </p>,
    );
  }
}
