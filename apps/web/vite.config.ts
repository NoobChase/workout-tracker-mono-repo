import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The service worker (design D13): precache the build, serve /index.html
    // for client routes, never answer /api/*. `prompt`: a new version waits
    // for the lifter (src/app/update-prompt.tsx) instead of reloading mid-set.
    VitePWA({
      strategies: "generateSW",
      registerType: "prompt",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png}"],
        // Bundled clerk-js + @clerk/ui push the app chunk past the 2 MiB
        // default (design D10 spike).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    // shadcn/ui's import alias (components.json); src/ only.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // CDK uploads this directory to the private S3 bucket behind CloudFront.
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    // Component and hook tests. Browser tests (e2e/) run under Playwright.
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
