import { Clerk } from "@clerk/clerk-js";
import { ClerkProvider } from "@clerk/react";
import { ui } from "@clerk/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createQueryClient, DataProvider } from "./data/provider.js";
import { httpApi, httpTransport } from "./local/http.js";
import { createDataLayer } from "./local/layer.js";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root is missing from index.html");
}

// The design kit at /design exists in development only. `import.meta.env.DEV`
// is the literal `false` in a production build, so this branch and the kit's
// chunk are dropped from the bundle entirely. It sits outside the router.
if (
  import.meta.env.DEV &&
  window.location.pathname.replace(/\/$/, "") === "/design"
) {
  void import("./design/kit.js").then(({ DesignKit }) => {
    createRoot(root).render(
      <StrictMode>
        <DesignKit />
      </StrictMode>,
    );
  });
} else {
  // Per stage, like the API's secret key: a production build carries the
  // production instance's key (.env.production), and the two instances sign
  // with different keys, so a mismatched pair fails verification in the API.
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set for this build");
  }

  // IndexedDB first (milliseconds, no network), then render. Clerk is never
  // awaited (design D10): `clerk-js` and its UI are bundled rather than
  // fetched from Clerk's servers, so an offline cold start still loads them,
  // and the app renders from the device's data while Clerk catches up.
  createDataLayer({ api: httpApi, transport: httpTransport })
    .then((layer) => {
      createRoot(root).render(
        <StrictMode>
          <ClerkProvider
            publishableKey={publishableKey}
            afterSignOutUrl="/"
            Clerk={Clerk}
            ui={ui}
          >
            <DataProvider layer={layer} queryClient={createQueryClient()}>
              <App />
            </DataProvider>
          </ClerkProvider>
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      // Private browsing in some browsers has no IndexedDB. Logging offline
      // can't work without it, so say so rather than render a broken app.
      console.error(error);
      root.textContent =
        "Tanren needs on-device storage to keep your sets safe, and this browser didn't allow it. Try leaving private browsing.";
    });
}
