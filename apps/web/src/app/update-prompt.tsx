import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { updates, type UpdateContext } from "../boot/updates.js";
import { useLastUser, useLocalSessions } from "../data/hooks.js";
import { onLocalDbEvent } from "../local/db.js";
import type { LastUser } from "../local/db.js";
import type { LocalSession } from "../local/sessions.js";
import { toast } from "@/ui/toaster";

const TOAST_ID = "tanren-update";

/** Clerk's flows and the landing page: nothing on them a reload loses. */
const PUBLIC_PATH = /^\/(sign-in|sign-up|about)(\/|$)/;
const AUTH_FLOW = /^\/(sign-in|sign-up)(\/|$)/;

/**
 * Where the app is, for the update policy (design D18): a public page when
 * nobody is signed in or the path is Clerk's or /about; else the app, with
 * whether this device holds a workout in progress (any account's: it is
 * still someone's place mid-set). `null` while the device record is read.
 */
export function appUpdateContext({
  pathname,
  lastUser,
  isSignedIn,
  sessions,
}: {
  pathname: string;
  lastUser: LastUser | null | undefined;
  isSignedIn: boolean | undefined;
  sessions: ReadonlyMap<string, LocalSession>;
}): UpdateContext | null {
  if (PUBLIC_PATH.test(pathname)) return { page: "public" };
  if (lastUser === undefined) return null;
  if (!lastUser && !isSignedIn) return { page: "public" };
  const workoutInProgress = [...sessions.values()].some(
    (record) => record.status === "IN_PROGRESS",
  );
  return { page: "app", workoutInProgress };
}

/**
 * Whether moving from one path to the next is a moment to reload: any
 * change of screen except a step inside Clerk's own flow
 * (`/sign-in` → `/sign-in/factor-one`), where a reload would drop the code
 * just sent.
 */
export function isSafeMove(from: string, to: string): boolean {
  if (from === to) return false;
  return !(AUTH_FLOW.test(from) && AUTH_FLOW.test(to));
}

/**
 * Tells the page's update controller (`boot/updates.ts`) where the app is,
 * and when a screen changes. Renders nothing.
 */
export function UpdatePolicy() {
  const lastUser = useLastUser();
  const { isSignedIn } = useAuth();
  const sessions = useLocalSessions();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const context = appUpdateContext({
    pathname,
    lastUser,
    isSignedIn,
    sessions,
  });
  const key = context ? JSON.stringify(context) : null;

  useEffect(() => {
    updates.setContext(key ? (JSON.parse(key) as UpdateContext) : null);
  }, [key]);

  // A plan-side write on the wire (a save, an activate) is no moment to
  // reload: the answer would be lost, and the screen with it.
  useEffect(
    () => updates.addBusyCheck(() => queryClient.isMutating() > 0),
    [queryClient],
  );

  const previous = useRef(pathname);
  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (!isSafeMove(from, pathname)) return;
    // After the screen that left has flushed its draft and closed its
    // dialogs (their cleanups run in this commit; the write they start is
    // held by the controller).
    const timer = window.setTimeout(() => updates.safeMoment(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  // A newer version opened in another tab and took the device's storage
  // (this tab's connection closed itself so the upgrade isn't held up).
  useEffect(
    () =>
      onLocalDbEvent((event) => {
        if (event.kind === "replaced") updates.replacedElsewhere();
      }),
    [],
  );

  return null;
}

const COPY = {
  waiting: {
    title: "A new version of Tanren is ready",
    description: "Reload when it suits you. Nothing you’ve logged is lost.",
  },
  elsewhere: {
    title: "Tanren was updated in another tab",
    description:
      "Reload this tab to keep going. Nothing you’ve logged is lost.",
  },
} as const;

/**
 * The prompt, only while a workout is in progress on this device (design
 * D18; everywhere else the update installs itself). It never reloads on its
 * own, so nobody loses their place mid-set. A toast that stays until
 * answered, at the top, where toasts land (the bottom belongs to Log set).
 * Reloading loses nothing: the record and the queue live in IndexedDB.
 */
export function UpdatePrompt() {
  const prompt = useSyncExternalStore(updates.subscribe, updates.getPrompt);

  useEffect(() => {
    if (!prompt) {
      toast.dismiss(TOAST_ID);
      return;
    }
    const copy = COPY[prompt];
    toast(copy.title, {
      id: TOAST_ID,
      description: copy.description,
      duration: Infinity,
      action: { label: "Reload", onClick: () => updates.applyNow() },
      cancel: { label: "Later", onClick: () => updates.dismiss() },
      onDismiss: () => updates.dismiss(),
    });
  }, [prompt]);

  return null;
}
