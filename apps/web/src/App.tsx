import {
  healthResponseSchema,
  type HealthResponse,
} from "@workout-tracker/shared";
import { useEffect, useState } from "react";

type State =
  | { status: "loading" }
  | { status: "ok"; health: HealthResponse }
  | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    // Same origin: CloudFront's /api/* behaviour forwards this to the Lambda
    // Function URL, so there is no CORS and no API hostname to configure.
    fetch("/api/hello", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`/api/hello returned ${response.status}`);
        }
        return healthResponseSchema.parse(await response.json());
      })
      .then((health) => setState({ status: "ok", health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: String(error) });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Workout Tracker</h1>
      <p className="text-sm text-neutral-500">
        Step 1 — infrastructure skeleton. Browser → CloudFront → Lambda Function
        URL → Neon.
      </p>

      {state.status === "loading" && (
        <p className="text-sm">Checking the pipe…</p>
      )}

      {state.status === "error" && (
        <p className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {state.message}
        </p>
      )}

      {state.status === "ok" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded border border-neutral-200 p-4 text-sm">
          <dt className="text-neutral-500">Message</dt>
          <dd>{state.health.message}</dd>
          <dt className="text-neutral-500">Database time</dt>
          <dd className="font-mono">{state.health.databaseTime}</dd>
          <dt className="text-neutral-500">Database</dt>
          <dd className="font-mono">{state.health.databaseVersion}</dd>
          <dt className="text-neutral-500">Cold start</dt>
          <dd className="font-mono">{String(state.health.coldStart)}</dd>
        </dl>
      )}
    </main>
  );
}
