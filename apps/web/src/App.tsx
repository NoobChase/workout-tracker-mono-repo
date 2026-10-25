import { Show, SignInButton, UserButton, useAuth } from "@clerk/react";
import {
  healthResponseSchema,
  meResponseSchema,
  type HealthResponse,
  type MeResponse,
} from "@workout-tracker/shared";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError, apiFetch } from "./api.js";

type Load<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

/** One GET through `apiFetch`, with its loading and error states. */
function useApi<T>(load: () => Promise<T>, describe: (e: unknown) => string) {
  const [state, setState] = useState<Load<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => !cancelled && setState({ status: "ok", data }))
      .catch(
        (error: unknown) =>
          !cancelled && setState({ status: "error", message: describe(error) }),
      );
    return () => {
      cancelled = true;
    };
    // Runs once per mount; callers remount (via `key`) to reload.
  }, []);

  return state;
}

export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 p-8 font-sans">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Workout Tracker
          </h1>
          <p className="text-sm text-neutral-500">
            Step 2: auth. Browser, Clerk, CloudFront, Lambda, Neon.
          </p>
        </div>
        {/* Reserves the control's height so nothing shifts when Clerk loads. */}
        <div className="flex h-9 shrink-0 items-center">
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button
                type="button"
                className="h-9 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 active:scale-[0.97]"
              >
                Sign in
              </button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </header>

      <Section title="Your account">
        <Show when="signed-out">
          <p className="text-sm text-neutral-600">
            Sign in to check that the API recognises you.
          </p>
        </Show>
        <Show when="signed-in">
          <Account />
        </Show>
      </Section>

      <Section title="API health">
        <Health />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}

/** Keyed by Clerk user, so switching accounts re-resolves on the server. */
function Account() {
  const { userId } = useAuth();
  return <AccountDetails key={userId} />;
}

function AccountDetails() {
  const state = useApi<MeResponse>(
    () => apiFetch("/api/me", meResponseSchema),
    (error) =>
      error instanceof ApiError && error.status === 401
        ? "You're signed in, but the API didn't accept your session. Sign out and back in; if it keeps happening, the API's Clerk configuration is wrong."
        : `Couldn't reach the API: ${String(error)}`,
  );

  return (
    <Loaded state={state} pending="Checking your account…">
      {(me) => (
        <Facts
          rows={[
            ["User id", me.userId],
            ["Subscription", me.subStatus],
          ]}
        />
      )}
    </Loaded>
  );
}

function Health() {
  const state = useApi<HealthResponse>(
    () => apiFetch("/api/hello", healthResponseSchema),
    (error) => `The API health check failed: ${String(error)}`,
  );

  return (
    <Loaded state={state} pending="Checking the API…">
      {(health) => (
        <Facts
          rows={[
            ["Message", health.message],
            ["Database time", health.databaseTime],
            ["Database", health.databaseVersion],
            ["Cold start", String(health.coldStart)],
          ]}
        />
      )}
    </Loaded>
  );
}

function Loaded<T>({
  state,
  pending,
  children,
}: {
  state: Load<T>;
  pending: string;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") {
    return <p className="text-sm text-neutral-600">{pending}</p>;
  }
  if (state.status === "error") {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800"
      >
        {state.message}
      </p>
    );
  }
  return children(state.data);
}

function Facts({ rows }: { rows: [label: string, value: string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md border border-neutral-200 p-4 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-neutral-500">{label}</dt>
          <dd className="font-mono break-all tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
