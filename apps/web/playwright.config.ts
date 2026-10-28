import { defineConfig, devices } from "@playwright/test";

const DEV_PORT = 5179;
const PREVIEW_PORT = 4179;

/*
 * Browser tests. `npm run test:e2e -w @workout-tracker/web` runs both
 * projects (needs `npx playwright install chromium` once):
 *
 * - `dev`: everything in e2e/ but the offline spec, against the Vite dev
 *   server. The design kit at /design only exists there.
 * - `preview`: e2e/offline.preview.ts, against a production build served by
 *   `vite preview`, because only a build has the service worker that makes
 *   an offline reload work. Built with `--mode development` so it carries
 *   the Clerk development instance's key (the production instance has no
 *   test identity); it is still a production bundle (`import.meta.env.DEV`
 *   is false, the kit is absent). Output goes to .e2e/dist, never dist/.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Every screen test signs in to one Clerk development account for real;
  // more than three at once and Clerk starts dropping code sends.
  workers: 3,
  forbidOnly: !!process.env.CI,
  // The screen tests sign in to Clerk's development instance for real.
  timeout: 90_000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "dev",
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${DEV_PORT}`,
      },
    },
    {
      name: "preview",
      testMatch: /.*\.preview\.ts/,
      timeout: 180_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${PREVIEW_PORT}`,
        serviceWorkers: "allow",
      },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}/design`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npx vite build --mode development --outDir .e2e/dist --emptyOutDir && npx vite preview --outDir .e2e/dist --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
