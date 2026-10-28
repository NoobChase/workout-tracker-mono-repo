import { SignIn, useAuth } from "@clerk/react";
import type { ReactNode } from "react";
import { useLastUser, useOnline } from "../data/hooks.js";
import { ThemeToggle } from "@/ui/theme-toggle";
import { Wordmark } from "@/ui/wordmark";
import { signInAppearance } from "./clerk-appearance.js";

/**
 * Renders the app from local data whenever a previous sign-in is recorded on
 * this device, without waiting for Clerk (design D10): offline, Clerk can take
 * 14s to load. Only with no record does it wait on Clerk, and then shows
 * sign-in once Clerk says nobody is signed in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const lastUser = useLastUser();
  const { isLoaded, isSignedIn } = useAuth();

  // IndexedDB is read before the first render (main.tsx); this is one frame.
  if (lastUser === undefined) return null;
  if (lastUser || isSignedIn) return children;
  return <SignedOut loaded={isLoaded} />;
}

/**
 * A first visit: Clerk's bundled sign-in, dressed in the tokens. Sign-up
 * stays Clerk's own link; this page doesn't advertise it.
 */
function SignedOut({ loaded }: { loaded: boolean }) {
  const online = useOnline();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-4 md:px-9">
          <Wordmark />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:pt-20">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance">
            Sign in to log today’s workout
          </h1>
          <p className="text-[15px] text-muted-foreground">
            Your program, every set you log, and the record of it. After this
            first sign-in, Tanren opens and logs with no signal.
          </p>
        </div>
        {loaded ? (
          <SignIn routing="hash" appearance={signInAppearance} />
        ) : online ? (
          <SignInPlaceholder />
        ) : (
          <p role="status" className="text-[15px] text-foreground">
            Signing in needs a connection the first time. Connect, and this page
            will continue on its own.
          </p>
        )}
      </main>
      <footer className="mx-auto w-full max-w-[1280px] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-[13px] text-faint md:px-9">
        Deliberate. Repeated. Recorded.
      </footer>
    </div>
  );
}

/** The card's footprint while Clerk loads, so the page doesn't jump. */
function SignInPlaceholder() {
  return (
    <div
      role="status"
      className="flex h-[22rem] flex-col gap-5 rounded-xl border border-line p-6"
    >
      <span className="sr-only">Loading sign-in</span>
      <span aria-hidden="true" className="h-3.5 w-24 rounded-sm bg-line" />
      <span aria-hidden="true" className="h-12 rounded-md border border-line" />
      <span aria-hidden="true" className="h-12 rounded-md bg-line" />
    </div>
  );
}
