import { SignIn, SignUp, useAuth } from "@clerk/react";
import { lazy, Suspense, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useLastUser, useOnline } from "../data/hooks.js";
import { ThemeToggle } from "@/ui/theme-toggle";
import { Wordmark } from "@/ui/wordmark";
import { signInAppearance } from "./clerk-appearance.js";

/** The same chunk the bootstrap shows a first visit; here after signing out. */
const Landing = lazy(() =>
  import("../landing/landing.js").then(({ Landing }) => ({ default: Landing })),
);

/** The query parameter that carries a deep link through sign-in (Clerk's own name). */
const REDIRECT_PARAM = "redirect_url";

/**
 * Where to go after signing in: the `redirect_url` the gate sent along, if it
 * is a path on this origin (never another site, never the auth pages
 * themselves), else home.
 */
export function afterSignIn(search: string): string {
  const raw = new URLSearchParams(search).get(REDIRECT_PARAM);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  try {
    const origin = window.location.origin;
    const url = new URL(raw, origin);
    if (url.origin !== origin) return "/";
    if (/^\/sign-(in|up)(\/|$)/.test(url.pathname)) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

/**
 * Renders the app from local data whenever a previous sign-in is recorded on
 * this device, without waiting for Clerk (design D10): offline, Clerk can take
 * 14s to load. With no record, `/` is the landing page until Clerk reports a
 * session (design D2). Any other screen waits for Clerk while it loads (a
 * signed-in visitor whose record is still being written, or was cleared,
 * stays where they are), then sends a signed-out visitor to sign in with the
 * address they asked for, which signing in returns them to. Offline, Clerk
 * can't settle, so the sign-in page says a connection is needed.
 */
export function AuthGate() {
  const lastUser = useLastUser();
  const { isLoaded, isSignedIn } = useAuth();
  const online = useOnline();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  // IndexedDB is read before the first render (app-root.tsx); one frame.
  if (lastUser === undefined) return null;
  if (lastUser || isSignedIn) return <Outlet />;
  if (pathname === "/") {
    return (
      <Suspense fallback={null}>
        <Landing onEnter={(path) => void navigate(path)} />
      </Suspense>
    );
  }
  if (!isLoaded && online) return <GateLoading />;
  const back = new URLSearchParams({
    [REDIRECT_PARAM]: pathname + search + hash,
  });
  return <Navigate to={`/sign-in?${back.toString()}`} replace />;
}

/**
 * `/about`: the landing page for everyone, reached from the account menu
 * (or typed). It never sends anyone anywhere; signed in (the device record
 * or Clerk's session), its calls to action read "Open app" and go home.
 * A hard load of `/about` is the bootstrap's landing branch instead, with
 * no app chunk before first paint (`main.tsx`); this is the same page once
 * the app is running.
 */
export function AboutPage() {
  const lastUser = useLastUser();
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  return (
    <Suspense fallback={null}>
      <Landing
        onEnter={(path) => void navigate(path)}
        signedIn={Boolean(lastUser) || isSignedIn === true}
      />
    </Suspense>
  );
}

/** The app's frame while Clerk decides who this is: nothing to act on yet. */
function GateLoading() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center px-4 md:px-9">
          <Wordmark />
        </div>
      </header>
      <p
        role="status"
        className="mx-auto w-full max-w-[1280px] px-4 pt-6 text-[15px] text-muted-foreground md:px-9"
      >
        Loading…
      </p>
    </div>
  );
}

const COPY = {
  "sign-in": {
    title: "Sign in to log today’s workout",
    lead: "Your program, every set you log, and the record of it. After this first sign-in, Tanren opens and logs with no signal.",
    offline:
      "Signing in needs a connection the first time. Connect, and this page will continue on its own.",
    loading: "Loading sign-in",
  },
  "sign-up": {
    title: "Create your Tanren account",
    lead: "Write your program once, then log each set in a tap. After this first sign-in, Tanren opens and logs with no signal.",
    offline:
      "Creating an account needs a connection. Connect, and this page will continue on its own.",
    loading: "Loading sign-up",
  },
} as const;

/**
 * `/sign-in` and `/sign-up`: Clerk's bundled forms, dressed in the tokens,
 * with path routing (Clerk's later steps live under the same path). Either
 * one ends on the address the gate sent along (`afterSignIn`), else home;
 * someone already signed in goes straight there.
 */
export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const { isLoaded, isSignedIn } = useAuth();
  const online = useOnline();
  const { search } = useLocation();
  const copy = COPY[mode];
  // Read once: Clerk's later steps (`/sign-in/factor-one`) are this same page.
  const [target] = useState(() => afterSignIn(search));

  if (isSignedIn) return <Navigate to={target} replace />;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-4 md:px-9">
          <Link to="/" className="-mx-1 flex h-11 items-center rounded-md px-1">
            <Wordmark />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:pt-20">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance">
            {copy.title}
          </h1>
          <p className="text-[15px] text-muted-foreground">{copy.lead}</p>
        </div>
        {isLoaded ? (
          mode === "sign-in" ? (
            <SignIn
              routing="path"
              path="/sign-in"
              forceRedirectUrl={target}
              signUpForceRedirectUrl={target}
              appearance={signInAppearance}
            />
          ) : (
            <SignUp
              routing="path"
              path="/sign-up"
              forceRedirectUrl={target}
              signInForceRedirectUrl={target}
              appearance={signInAppearance}
            />
          )
        ) : online ? (
          <FormPlaceholder label={copy.loading} />
        ) : (
          <p role="status" className="text-[15px] text-foreground">
            {copy.offline}
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
function FormPlaceholder({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex h-[22rem] flex-col gap-5 rounded-xl border border-line p-6"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="h-3.5 w-24 rounded-sm bg-line" />
      <span aria-hidden="true" className="h-12 rounded-md border border-line" />
      <span aria-hidden="true" className="h-12 rounded-md bg-line" />
    </div>
  );
}
