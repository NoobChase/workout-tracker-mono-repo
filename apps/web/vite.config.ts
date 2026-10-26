import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
