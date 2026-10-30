import { useCallback, useEffect, useState, type ComponentType } from "react";

/** Where the landing page's calls to action lead (Clerk, in the app chunk). */
export type AuthPath = "/sign-in" | "/sign-up";

export interface LandingProps {
  /** "Log in" passes `/sign-in`; "Get started" and the trial, `/sign-up`. */
  onAuth: (path: AuthPath) => void;
}

export interface AppRootProps {
  /**
   * False while the landing page is showing: the app chunk then only asks
   * Clerk whether someone is signed in, and renders nothing.
   */
  active: boolean;
  /** Clerk reports a session while the landing page is showing. */
  onSignedIn: () => void;
}

/** What the app chunk (`app/app-root.tsx`) exports. */
export interface AppModule {
  AppRoot: ComponentType<AppRootProps>;
}

/**
 * The 33 strokes draw for about three seconds. Parsing the app chunk (Clerk
 * is most of it) on the main thread while they draw would stall the brush,
 * so the prefetch waits for them, then for idle time.
 */
export const PREFETCH_DELAY_MS = 3_500;

/** Runs `task` once the landing page has painted and the browser is idle. */
export function whenIdleAfterIntro(task: () => void): () => void {
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(task, { timeout: 2_000 });
    } else {
      task();
    }
  }, PREFETCH_DELAY_MS);
  return () => {
    window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

/**
 * The bootstrap's root (design D2). It shows whichever chunk `main.tsx`
 * picked from the device's last-user record, and moves from the landing page
 * to the app at most once:
 *
 * - on a call to action, which pushes `/sign-in` or `/sign-up` and shows the
 *   app (Clerk's form) as soon as its chunk is here;
 * - when Clerk, loaded in idle time behind the landing page, reports a
 *   session (a signed-in lifter whose device record was cleared).
 *
 * The app root is always the second child, so it keeps its place (and its
 * one Clerk instance) when the landing page before it goes away.
 */
export function Shell({
  Landing,
  app: initialApp,
  loadApp,
  whenIdle = whenIdleAfterIntro,
}: {
  /** The landing page when the bootstrap picked it, else null. */
  Landing: ComponentType<LandingProps> | null;
  /** The app chunk, when the bootstrap already loaded it. */
  app: AppModule | null;
  loadApp: () => Promise<AppModule>;
  whenIdle?: (task: () => void) => () => void;
}) {
  const [app, setApp] = useState<AppModule | null>(initialApp);
  const [entered, setEntered] = useState(Landing === null);
  const [pending, setPending] = useState<AuthPath | null>(null);

  // Behind the landing page, fetch the app chunk once nothing else is going on.
  useEffect(() => {
    if (app) return;
    return whenIdle(() => {
      loadApp().then(setApp, () => {
        // A failed prefetch is retried by the call to action.
      });
    });
  }, [app, loadApp, whenIdle]);

  // A call to action pressed before the chunk arrived goes through once it has.
  useEffect(() => {
    if (!app || !pending) return;
    window.history.pushState(null, "", pending);
    setPending(null);
    setEntered(true);
  }, [app, pending]);

  const onAuth = useCallback(
    (path: AuthPath) => {
      if (app) {
        window.history.pushState(null, "", path);
        setEntered(true);
        return;
      }
      setPending(path);
      loadApp().then(setApp, () => {
        // The chunk didn't come (a deploy replaced it, or no connection):
        // a real navigation starts over from the bootstrap, which says so.
        window.location.assign(path);
      });
    },
    [app, loadApp],
  );

  const onSignedIn = useCallback(() => setEntered(true), []);

  return (
    <>
      {!entered && Landing ? <Landing onAuth={onAuth} /> : null}
      {app ? <app.AppRoot active={entered} onSignedIn={onSignedIn} /> : null}
    </>
  );
}
