import type { RegisterSWOptions } from "virtual:pwa-register";

/*
 * Updates install themselves when it is safe (step 4a design D18, amending
 * step 3's D13, which only ever prompted).
 *
 * The service worker stays `registerType: "prompt"`: a new version waits
 * until this page says so. What the page says depends on where it is:
 *
 * - a public page (the landing page, /about, sign-in and sign-up, a
 *   signed-out visitor): at once, a skip-waiting and a reload;
 * - the signed-in app with no workout in progress on this device: at the
 *   next safe moment (a route change, or the page going hidden or visible
 *   again), once pending drafts are written and no dialog is open;
 * - a workout in progress on this device: never on its own. The toast
 *   ("A new version of Tanren is ready · Reload") asks, as it always did.
 *
 * One registration per page, made by the bootstrap (`main.tsx`) for both
 * branches, so the landing page and the app never hold two Workbox
 * instances. Everything a reload could lose lives in IndexedDB already (the
 * queue and the session records, written in one transaction before a write
 * is sent; builder drafts once flushed, which `apply` waits for).
 */

export type UpdatePolicy = "now" | "at-safe-moment" | "prompt";

/** Where the page is, for the policy. */
export type UpdateContext =
  /** The landing page, /about, sign-in and sign-up, or nobody signed in. */
  | { page: "public" }
  /** The signed-in app; whether this device holds an IN_PROGRESS session. */
  | { page: "app"; workoutInProgress: boolean };

/** The decision (design D18). Pure: the controller below acts on it. */
export function updatePolicy(context: UpdateContext): UpdatePolicy {
  if (context.page === "public") return "now";
  return context.workoutInProgress ? "prompt" : "at-safe-moment";
}

/**
 * What is waiting: a new version installed here (`waiting`), or one that
 * another tab already activated (`elsewhere`: its service worker took over,
 * or its upgrade closed this tab's storage), which only a reload brings in.
 */
export type PendingUpdate = "waiting" | "elsewhere";

export interface UpdateEnv {
  /** `registerSW` from `virtual:pwa-register`. */
  register: (
    options: RegisterSWOptions,
  ) => (reloadPage?: boolean) => Promise<void>;
  reload: () => void;
  /** An open dialog or a focused text field: not a moment to reload. */
  isBusy: () => boolean;
  /** Where visibility changes are heard (the document). */
  visibility?: Pick<Document, "addEventListener" | "visibilityState">;
  now?: () => number;
}

/** How often a long-open page asks the server for a new service worker. */
export const UPDATE_CHECK_INTERVAL_MS = 10 * 60_000;

export class Updates {
  readonly #env: UpdateEnv;
  #pending: PendingUpdate | null = null;
  #context: UpdateContext | null = null;
  #prompt: PendingUpdate | null = null;
  #dismissed = false;
  #applying = false;
  #started = false;
  #skipWaiting: ((reloadPage?: boolean) => Promise<void>) | null = null;
  #registration: ServiceWorkerRegistration | undefined;
  #lastCheck = 0;
  readonly #flushers = new Set<() => unknown>();
  readonly #holds = new Set<Promise<unknown>>();
  readonly #busyChecks = new Set<() => boolean>();
  readonly #listeners = new Set<() => void>();

  constructor(env: UpdateEnv) {
    this.#env = env;
  }

  /** Registers the service worker, once per page. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const now = this.#env.now ?? Date.now;
    this.#lastCheck = now();
    this.#skipWaiting = this.#env.register({
      onNeedRefresh: () => this.#found("waiting"),
      // The new worker took control: after our own skip-waiting, the
      // reload; otherwise another tab activated it under this page.
      onNeedReload: () => {
        if (this.#applying) this.#env.reload();
        else this.#found("elsewhere");
      },
      onRegisteredSW: (_url, registration) => {
        this.#registration = registration;
      },
    });
    const visibility = this.#env.visibility;
    visibility?.addEventListener("visibilitychange", () => {
      // Back on a page left open: ask whether a new version shipped since.
      if (
        visibility.visibilityState === "visible" &&
        now() - this.#lastCheck >= UPDATE_CHECK_INTERVAL_MS
      ) {
        this.#lastCheck = now();
        void this.#registration?.update().catch(() => {
          // Offline, or the server is away: the next visit asks again.
        });
      }
      this.safeMoment();
    });
  }

  /** Where the page is now; `null` while that isn't known yet. */
  setContext(context: UpdateContext | null): void {
    this.#context = context;
    this.#evaluate(false);
  }

  /** A route change: the moment between one screen and the next. */
  safeMoment(): void {
    this.#evaluate(true);
  }

  /** Another tab's upgrade closed this tab's storage (`replaced`). */
  replacedElsewhere(): void {
    this.#found("elsewhere");
  }

  /** The prompt's Reload. */
  applyNow(): void {
    void this.#apply();
  }

  /** The prompt's Later: it stays quiet until this page is asked again. */
  dismiss(): void {
    // The toast also reports a dismissal it was told to make (the prompt
    // went away by itself): that is no answer from anyone.
    if (!this.#prompt) return;
    this.#dismissed = true;
    this.#setPrompt(null);
  }

  /** Called before a reload; the reload waits for what it returns. */
  beforeUpdate(flush: () => unknown): () => void {
    this.#flushers.add(flush);
    return () => this.#flushers.delete(flush);
  }

  /** A write the reload must wait for (a draft on its way to IndexedDB). */
  hold(work: Promise<unknown>): void {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.#holds.add(settled);
    void settled.then(() => this.#holds.delete(settled));
  }

  /** More reasons not to reload yet (a plan-side write on the wire). */
  addBusyCheck(check: () => boolean): () => void {
    this.#busyChecks.add(check);
    return () => this.#busyChecks.delete(check);
  }

  /** What the prompt shows, if anything. */
  getPrompt = (): PendingUpdate | null => this.#prompt;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #found(kind: PendingUpdate): void {
    // Something already waiting here, then taken by another tab: the reload
    // is what is left to do either way.
    this.#pending = kind;
    this.#dismissed = false;
    this.#evaluate(false);
  }

  #evaluate(safeMoment: boolean): void {
    if (!this.#pending || this.#applying || !this.#context) return;
    const policy = updatePolicy(this.#context);
    if (policy === "prompt") {
      this.#setPrompt(this.#dismissed ? null : this.#pending);
      return;
    }
    this.#setPrompt(null);
    if (policy === "at-safe-moment" && !safeMoment) return;
    // "now" on a page where someone is typing waits for a safe moment too.
    if (this.#busy()) return;
    void this.#apply();
  }

  #busy(): boolean {
    if (this.#env.isBusy()) return true;
    for (const check of this.#busyChecks) if (check()) return true;
    return false;
  }

  async #apply(): Promise<void> {
    if (this.#applying || !this.#pending) return;
    this.#applying = true;
    this.#setPrompt(null);
    // A flusher that throws is a draft not kept; the update still goes.
    await Promise.allSettled(
      [...this.#flushers].map((f) => Promise.resolve().then(f)),
    );
    await Promise.allSettled([...this.#holds]);
    if (this.#pending === "waiting" && this.#skipWaiting) {
      // The waiting worker activates; `onNeedReload` then reloads.
      await this.#skipWaiting(true);
    } else {
      this.#env.reload();
    }
  }

  #setPrompt(prompt: PendingUpdate | null): void {
    if (this.#prompt === prompt) return;
    this.#prompt = prompt;
    for (const listener of this.#listeners) listener();
  }
}

/** An open dialog (sheets are dialogs) or a focused text field. */
export function pageIsBusy(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const active = doc.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  if (active instanceof HTMLTextAreaElement) return true;
  return (
    active instanceof HTMLInputElement &&
    !["button", "submit", "reset", "checkbox", "radio", "range"].includes(
      active.type,
    )
  );
}

/**
 * The page's one controller. `main.tsx` starts it; the app's screens set its
 * context and lend it their drafts.
 */
export const updates = new Updates({
  register: (options) => {
    let skipWaiting: ((reloadPage?: boolean) => Promise<void>) | null = null;
    const registered = import("virtual:pwa-register").then(({ registerSW }) => {
      skipWaiting = registerSW(options);
    });
    return async (reloadPage) => {
      await registered;
      await skipWaiting?.(reloadPage);
    };
  },
  reload: () => window.location.reload(),
  isBusy: () => pageIsBusy(),
  visibility: typeof document === "undefined" ? undefined : document,
});
