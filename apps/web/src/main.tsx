import { ClerkProvider } from "@clerk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root is missing from index.html");
}

// The design kit at /design exists in development only. `import.meta.env.DEV`
// is the literal `false` in a production build, so this branch and the kit's
// chunk are dropped from the bundle entirely. No router: one path, one check.
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

  createRoot(root).render(
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </StrictMode>,
  );
}
