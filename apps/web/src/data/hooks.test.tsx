import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  newId,
  type CreateExerciseRequest,
  type EditExerciseRequest,
  type ExerciseListItem,
  type ProgramDetailResponse,
} from "@workout-tracker/shared";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NetworkError } from "../api.js";
import {
  contextFor,
  ids,
  makeHarness,
  prefetch,
  withOutlineFixture,
  type Harness,
} from "../test/fakes.js";
import {
  useExerciseActions,
  useFinishAndStartNext,
  useNext,
  useProgram,
  useProgramActions,
  useUnits,
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

/** A hook under the harness's data layer and a query client of its own. */
function hookOf<T>(
  h: Harness,
  hook: () => T,
  queryClient = createQueryClient(),
) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <DataProvider layer={h.layer} queryClient={queryClient}>
        {children}
      </DataProvider>
    ),
  });
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
  const finishAndStart = useFinishAndStartNext();
  const [opened, setOpened] = useState<string | null>(null);
  const entry = next.inProgress[0];
  return (
    <div>
      <p data-testid="source">{next.source}</p>
      {opened ? <p data-testid="opened">{opened}</p> : null}
      {entry ? (
        <button
          type="button"
          onClick={() =>
            void finishAndStart(entry, next.successorOf(entry.workoutId)).then(
              (r) => setOpened(r.kind === "started" ? r.sessionId : r.kind),
            )
          }
        >
          Finish & start next
        </button>
      ) : null}
      <ul>
        {next.next.map((n) => {
          const after = next.successorOf(n.workoutId);
          return [
            <li key={n.workoutId}>{`next: ${n.workoutName}`}</li>,
            after.kind === "workout" ? (
              <li
                key={`after-${n.workoutId}`}
              >{`after ${n.workoutName}: ${after.item.workoutName}`}</li>
            ) : null,
          ];
        })}
        {next.waiting.map((w) => (
          <li key={w.programId}>
            {`waiting: ${w.kind}${w.kind === "new-cycle" ? ` ${w.cycleNumber} ${w.workoutName}` : ""}`}
          </li>
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

describe("useNext after a skip or finish on this device (step 4a D15)", () => {
  async function offlineWithOutline() {
    const h = await setup();
    withOutlineFixture(h.api);
    await prefetch(h);
    h.connectivity.set(false);
    return h;
  }

  it("prefetches the following workout's plan, so it starts offline", async () => {
    const h = await offlineWithOutline();
    expect(h.api.contextCalls).toContain(ids.workout3);
  });

  it("moves home on at once when the next workout is skipped offline", async () => {
    const h = await offlineWithOutline();
    wrap(h, <Next />);
    expect(await screen.findByText("next: Push A")).toBeInTheDocument();

    await h.layer.sessions.skip(ids.workout);
    expect(await screen.findByText("next: Pull A")).toBeInTheDocument();
    expect(screen.queryByText("next: Push A")).not.toBeInTheDocument();

    await h.layer.sessions.skip(ids.workout3);
    expect(await screen.findByText("next: Legs A")).toBeInTheDocument();

    // The cycle's last: only the server can mint cycle 2, so the program
    // waits for it, named.
    await h.layer.sessions.skip(ids.workout2);
    expect(
      await screen.findByText("waiting: new-cycle 2 Push A"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^next:/)).not.toBeInTheDocument();
    expect(h.server.applied).toEqual([]);
  });

  it("names what moves up before a skip", async () => {
    const h = await offlineWithOutline();
    wrap(h, <Next />);
    expect(await screen.findByText("after Push A: Pull A")).toBeInTheDocument();
  });

  it("Finish & start next queues the finish, then starts the following workout, offline", async () => {
    const h = await offlineWithOutline();
    const push = await h.layer.sessions.start(ids.workout);
    wrap(h, <Next />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Finish & start next" }),
    );

    const opened = await screen.findByTestId("opened");
    const pull = opened.textContent;
    expect(pull).not.toBe(push);
    expect(h.layer.sessions.get(push)?.status).toBe("FINISHED");
    expect(h.layer.sessions.get(pull)).toMatchObject({
      workoutId: ids.workout3,
      status: "IN_PROGRESS",
    });
    expect(
      h.layer.queue.getState().items.map((i) => `${i.op} ${i.sessionId}`),
    ).toEqual([`start ${push}`, `finish ${push}`, `start ${pull}`]);
  });
});

describe("Finish & start next, the harder cases", () => {
  it("pressed twice at once: one finish, one start of the following workout", async () => {
    const h = await setup();
    withOutlineFixture(h.api);
    await prefetch(h);
    h.connectivity.set(false);
    const push = await h.layer.sessions.start(ids.workout);
    const { result } = hookOf(h, () => ({
      next: useNext(),
      finishAndStart: useFinishAndStartNext(),
    }));
    // The session listed, and the device's outline read.
    await waitFor(() => {
      const [entry] = result.current.next.inProgress;
      expect(entry).toBeDefined();
      expect(result.current.next.successorOf(entry!.workoutId).kind).not.toBe(
        "unknown",
      );
    });
    const entry = result.current.next.inProgress[0]!;
    const after = result.current.next.successorOf(entry.workoutId);

    const [a, b] = await act(() =>
      Promise.all([
        result.current.finishAndStart(entry, after),
        result.current.finishAndStart(entry, after),
      ]),
    );

    expect(a).toMatchObject({ kind: "started" });
    expect(b).toEqual(a);
    const pull = a.kind === "started" ? a.sessionId : "";
    expect(
      h.layer.queue.getState().items.map((i) => `${i.op} ${i.sessionId}`),
    ).toEqual([`start ${push}`, `finish ${push}`, `start ${pull}`]);
  });

  it("online, at an open-ended program's roll-over: waits for the finish to land, rereads what's next, and starts the new cycle's first workout", async () => {
    const h = await setup();
    withOutlineFixture(h.api);
    // Legs A is cycle 1's last workout; the server mints cycle 2 when its
    // finish arrives.
    const cycle2Push = newId();
    const legsDone = () =>
      [...h.server.sessions.values()].some(
        (s) => s.workoutId === ids.workout2 && s.status === "COMPLETED",
      );
    h.api.next = () =>
      Promise.resolve({
        next: [
          legsDone()
            ? {
                programId: ids.program,
                programName: "Push Pull Legs",
                workoutId: cycle2Push,
                workoutName: "Push A",
                cycleNumber: 2,
              }
            : {
                programId: ids.program,
                programName: "Push Pull Legs",
                workoutId: ids.workout2,
                workoutName: "Legs A",
                cycleNumber: 1,
              },
        ],
        inProgress: [],
      });
    await prefetch(h);
    const legs = await h.layer.sessions.start(ids.workout2);
    await h.layer.queue.settled();
    const { result } = hookOf(h, () => ({
      next: useNext(),
      finishAndStart: useFinishAndStartNext(),
    }));
    // The session listed, and the device's outline read.
    await waitFor(() => {
      const [entry] = result.current.next.inProgress;
      expect(entry).toBeDefined();
      expect(result.current.next.successorOf(entry!.workoutId).kind).not.toBe(
        "unknown",
      );
    });
    const entry = result.current.next.inProgress[0]!;
    const after = result.current.next.successorOf(entry.workoutId);
    // The device can't name it: the cycle doesn't exist yet.
    expect(after).toMatchObject({ kind: "new-cycle", cycleNumber: 2 });

    const outcome = await act(() =>
      result.current.finishAndStart(entry, after),
    );

    expect(outcome).toMatchObject({ kind: "started", workoutName: "Push A" });
    const started = outcome.kind === "started" ? outcome.sessionId : "";
    expect(h.layer.sessions.get(started)).toMatchObject({
      workoutId: cycle2Push,
      status: "IN_PROGRESS",
    });
    // In order: the finish reached the server before the new start.
    await h.layer.queue.settled();
    expect(h.server.applied.map((r) => r.path)).toEqual([
      `/api/sessions/${legs}`,
      `/api/sessions/${legs}/finish`,
      `/api/sessions/${started}`,
    ]);
    expect(h.api.contextCalls).toContain(cycle2Push);
    expect(contextFor(cycle2Push).workout.id).toBe(cycle2Push);
  });
});

describe("creating an exercise", () => {
  /** Applies creates like the services: a replay answers with the stored row. */
  function catalogServer(h: Harness) {
    const rows = new Map<string, ExerciseListItem>();
    let loseNext = false;
    const toRow = (r: CreateExerciseRequest): ExerciseListItem => ({
      id: r.id,
      name: r.name,
      isCustom: true,
      isActive: true,
      primaryMuscles: r.primaryMuscles,
      secondaryMuscles: r.secondaryMuscles,
      equipment: r.equipment,
      metrics: r.metrics,
      setup: null,
      cues: null,
    });
    h.api.createExercise = (r: CreateExerciseRequest) => {
      if (!rows.has(r.id)) rows.set(r.id, toRow(r));
      if (loseNext) {
        loseNext = false;
        return Promise.reject(new NetworkError("/api/exercises", null));
      }
      return Promise.resolve({ exercise: rows.get(r.id)! });
    };
    h.api.editExercise = (id: string, patch: EditExerciseRequest) => {
      const row = { ...rows.get(id)!, ...patch };
      rows.set(id, row);
      return Promise.resolve({ exercise: row });
    };
    return {
      rows,
      loseNextAnswer: () => {
        loseNext = true;
      },
    };
  }

  const input = (name: string): Omit<CreateExerciseRequest, "id"> => ({
    name,
    primaryMuscles: ["GLUTES"],
    secondaryMuscles: [],
    equipment: null,
    metrics: [{ metric: "REPS", isRequired: true }],
  });

  it("a lost answer, then an edited retry from a reopened form, is one exercise with the edit", async () => {
    const h = await setup();
    const server = catalogServer(h);
    const queryClient = createQueryClient();

    const first = hookOf(h, () => useExerciseActions(), queryClient);
    server.loseNextAnswer();
    await act(() =>
      first.result.current.create
        .mutateAsync(input("Reverse Hyper"))
        .catch(() => undefined),
    );
    expect(server.rows.size).toBe(1);
    // The sheet is closed and opened again, and the name corrected.
    first.unmount();
    const second = hookOf(h, () => useExerciseActions(), queryClient);
    const result = await act(() =>
      second.result.current.create.mutateAsync(input("Reverse Hyperextension")),
    );

    expect(server.rows.size).toBe(1);
    expect(result.exercise.name).toBe("Reverse Hyperextension");
    expect([...server.rows.values()][0]!.name).toBe("Reverse Hyperextension");

    // Done: the next create is another exercise.
    await act(() => second.result.current.create.mutateAsync(input("Nordic")));
    expect(server.rows.size).toBe(2);
  });
});

describe("useUnits (the builder's units)", () => {
  function Units() {
    const units = useUnits();
    return <p data-testid="units">{units ? JSON.stringify(units) : "…"}</p>;
  }

  it("comes from the exercise catalog read: the default and the overrides", async () => {
    const h = await setup();
    h.api.exercises = () =>
      Promise.resolve({
        exercises: [],
        units: {
          default: "KG" as const,
          overrides: { [ids.workout]: "LB" as const },
        },
      });
    wrap(h, <Units />);
    await waitFor(() =>
      expect(screen.getByTestId("units").textContent).toBe(
        JSON.stringify({ default: "KG", overrides: { [ids.workout]: "LB" } }),
      ),
    );
  });

  it("offline with no catalog read, the newest cached workout context stands in", async () => {
    const h = await setup();
    await prefetch(h);
    h.connectivity.set(false);
    h.api.exercises = () => Promise.reject(new Error("offline"));
    wrap(h, <Units />);
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("units").textContent)).toEqual({
        default: "LB",
        overrides: { [ids.frontSquat.exercise]: "KG" },
      }),
    );
  });
});

describe("what a write refreshes (AFFECTS)", () => {
  /** A fixed one-cycle program, finished, as the server tells it. */
  function programServer(h: Harness) {
    let detail: ProgramDetailResponse = {
      program: {
        id: ids.program,
        name: "Base",
        status: "COMPLETED",
        targetCycles: 1,
        currentCycle: null,
      },
      cycles: [{ cycleNumber: 1, trained: true, fullyTrained: true }],
    };
    let reads = 0;
    h.api.program = () => {
      reads += 1;
      return Promise.resolve(detail);
    };
    h.api.renameProgram = (_, { name }) => {
      detail = { ...detail, program: { ...detail.program, name } };
      return Promise.resolve({ program: detail.program });
    };
    h.api.extendProgram = () => {
      detail = {
        program: {
          ...detail.program,
          status: "ACTIVE",
          targetCycles: 2,
          currentCycle: 2,
        },
        cycles: [
          ...detail.cycles,
          { cycleNumber: 2, trained: false, fullyTrained: false },
        ],
      };
      return Promise.resolve({ program: detail.program });
    };
    return { reads: () => reads };
  }

  it("a rename and an extend reread the program's own page, not only the list", async () => {
    const h = await setup();
    programServer(h);
    const { result } = hookOf(h, () => ({
      detail: useProgram(ids.program),
      actions: useProgramActions(),
    }));
    await waitFor(() =>
      expect(result.current.detail.data?.program.name).toBe("Base"),
    );

    await act(() =>
      result.current.actions.rename.mutateAsync({
        programId: ids.program,
        name: "Base Building",
      }),
    );
    await waitFor(() =>
      expect(result.current.detail.data?.program.name).toBe("Base Building"),
    );

    await act(() => result.current.actions.extend.mutateAsync(ids.program));
    await waitFor(() =>
      expect(result.current.detail.data?.cycles).toHaveLength(2),
    );
    expect(result.current.detail.data?.program).toMatchObject({
      status: "ACTIVE",
      targetCycles: 2,
    });
  });

  it("a delivered finish rereads the program's page (its cycles' trained flags)", async () => {
    const h = await setup();
    await prefetch(h);
    const server = programServer(h);
    const sessionId = await h.layer.sessions.start(ids.workout);
    await h.layer.queue.settled();
    const { result } = hookOf(h, () => useProgram(ids.program));
    await waitFor(() => expect(result.current.data).toBeDefined());
    const before = server.reads();

    await h.layer.sessions.finish(sessionId);
    await h.layer.queue.settled();
    await waitFor(() => expect(server.reads()).toBeGreaterThan(before));
  });
});

describe("a workout started on another device", () => {
  it("needs a connection to come to this one, and says so", async () => {
    const h = await setup();
    h.connectivity.set(false);
    await expect(
      h.layer.ensureOnDevice(
        { sessionId: newId(), workoutId: ids.workout },
        "Finishing",
      ),
    ).rejects.toMatchObject({
      code: "needs-connection",
      message:
        "This workout was started on another device. Finishing it here needs a connection the first time.",
    });
  });
});
