import { defineConfig, devices } from "@playwright/test";

const PORT = 5179;

/*
 * Browser tests against the Vite dev server. The design kit at /design only
 * exists in development, so these never run against a production build.
 * `npm run test:e2e -w @workout-tracker/web` (needs `npx playwright install
 * chromium` once).
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/design`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
