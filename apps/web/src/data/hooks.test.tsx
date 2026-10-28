import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ids, makeHarness, prefetch, type Harness } from "../test/fakes.js";
import {
  useNext,
  useSessionRecord,
  useSyncStatus,
  useWorkoutActions,
} from "./hooks.js";
import { createQueryClient, DataProvider } from "./provider.js";

let harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses) h.layer.close();
  harnesses = [];
});

async function setup() {
  const h = await makeHarness();
  harnesses.push(h);
  return h;
}

function wrap(h: Harness, ui: ReactNode) {
  return render(
    <DataProvider layer={h.layer} queryClient={createQueryClient()}>
      {ui}
    </DataProvider>,
  );
}

function Logger({ sessionId }: { sessionId: string }) {
  const view = useSessionRecord(sessionId);
  const actions = useWorkoutActions();
  const sync = useSyncStatus();
  if (!view) return <p>missing</p>;
  const bench = view.exercises[0]!;
  return (
    <div>
      <p data-testid="sync">{`${sync.state} ${sync.pending}`}</p>
      <ol>
        {bench.sets.map((s) => (
          <li
            key={s.id}
          >{`${s.setNumber}: ${s.weight} ${s.weightUnit} x ${s.reps} (${s.sync.state})`}</li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() =>
          void actions.logSet(sessionId, {
            plannedExerciseId: bench.planned.plannedExerciseId,
            reps: 5,
            weight: bench.planned.lastTime?.sets[0]?.weight ?? 0,
          })
        }
      >
        Log set
      </button>
    </div>
  );
}

describe("useSessionRecord + useWorkoutActions", () => {
  it("shows a set logged offline at once, marked queued with no signal, then logged on reconnect", async () => {
    const h = await setup();
    await prefetch(h);
    h.connectivity.set(false);
    const sessionId = await h.layer.sessions.start(ids.workout);
    wrap(h, <Logger sessionId={sessionId} />);

    await userEvent.click(screen.getByRole("button", { name: "Log set" }));
    expect(
      await screen.findByText("1: 225 LB x 5 (queued-no-signal)"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sync")).toHaveTextContent("offline 2");

    h.connectivity.set(true);
    expect(
      await screen.findByText("1: 225 LB x 5 (logged)"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("sync")).toHaveTextContent("synced 0"),
    );
  });
});

function Next() {
  const next = useNext();
  return (
    <div>
      <p data-testid="source">{next.source}</p>
      <ul>
        {next.next.map((n) => (
          <li key={n.workoutId}>{`next: ${n.workoutName}`}</li>
        ))}
        {next.inProgress.map((s) => (
          <li
            key={s.sessionId}
          >{`resume: ${s.workoutName} (${s.onDevice ? "device" : "server"})`}</li>
        ))}
      </ul>
    </div>
  );
}

describe("useNext", () => {
  it("falls back to the device's snapshot, and offers a session started offline", async () => {
    const h = await setup();
    await prefetch(h);
    h.connectivity.set(false);
    await h.layer.sessions.start(ids.workout);
    h.api.next = () => Promise.reject(new TypeError("Failed to fetch"));
    wrap(h, <Next />);

    expect(await screen.findByText("next: Push A")).toBeInTheDocument();
    expect(screen.getByText("resume: Push A (device)")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("source")).toHaveTextContent("device"),
    );
  });

  it("stops listing a workout finished on this device before the finish syncs", async () => {
    const h = await setup();
    await prefetch(h);
    h.connectivity.set(false);
    const sessionId = await h.layer.sessions.start(ids.workout);
    await h.layer.sessions.finish(sessionId);
    wrap(h, <Next />);

    await waitFor(() =>
      expect(screen.getByTestId("source")).not.toHaveTextContent("none"),
    );
    expect(screen.queryByText("next: Push A")).not.toBeInTheDocument();
    expect(screen.queryByText(/resume:/)).not.toBeInTheDocument();
  });
});
