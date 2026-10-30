/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Clerk publishable key for this build's stage (`.env.production`). */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
