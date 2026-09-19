import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // CDK uploads this directory to the private S3 bucket behind CloudFront.
    outDir: "dist",
    emptyOutDir: true,
  },
});
