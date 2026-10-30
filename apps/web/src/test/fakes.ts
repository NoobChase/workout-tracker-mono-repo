import {
  editSetRequest,
  logSetRequest,
  newId,
  skipWorkoutRequest,
  startWorkoutRequest,
  type CycleDetailResponse,
  type ProgramListResponse,
  type WhatsNextResponse,
  type WorkoutContextResponse,
} from "@workout-tracker/shared";
import { ApiError } from "../api.js";
import { OfflineError } from "../auth.js";
import {
  DataLayer,
  type Connectivity,
  type ServerApi,
} from "../local/layer.js";
import { openLocalDb } from "../local/db.js";
import type { Mutation, Timers, Transport } from "../local/queue.js";

/*
 * Test doubles for the data layer: a fake API server that applies queued
 * writes the way `packages/services` does (upsert on client ids, renumber on
 * delete, drop an emptied session exercise), a fake read API, manual timers
 * and a switchable connection. Not part of the app bundle.
 */

export const USER = "user_test_1";

export const ids = {
  program: newId(),
  workout: newId(),
  workout2: newId(),
  workout3: newId(),
  lastSession: newId(),
  bench: { planned: newId(), exercise: newId() },
  frontSquat: { planned: newId(), exercise: newId() },
};

/** Default LB, with a KG override on Front Squat (offline-logging spec). */
export function contextFor(workoutId = ids.workout): WorkoutContextResponse {
  return {
    workout: {
      id: workoutId,
      name:
        workoutId === ids.workout
          ? "Push A"
          : workoutId === ids.workout3
            ? "Pull A"
            : "Legs A",
      position: 0,
      cycleNumber: 1,
      programId: ids.program,
      programName: "Push Pull Legs",
    },
    units: { default: "LB", overrides: { [ids.frontSquat.exercise]: "KG" } },
    exercises: [
      {
        plannedExerciseId: ids.bench.planned,
        position: 0,
        exerciseId: ids.bench.exercise,
        name: "Bench Press",
        metrics: ["weight", "reps"],
        targetSets: 3,
        plannedSets: [1, 2, 3].map((n) => ({
          setNumber: n,
          repsMin: 5,
          repsMax: 8,
          weight: null,
          weightUnit: null,
        })),
        lastTime: {
          sessionId: ids.lastSession,
          performedAt: "2026-10-20T10:00:00.000Z",
          sets: [{ setNumber: 1, reps: 5, weight: 225, weightUnit: "LB" }],
        },
      },
      {
        plannedExerciseId: ids.frontSquat.planned,
        position: 1,
        exerciseId: ids.frontSquat.exercise,
        name: "Front Squat",
        metrics: ["weight", "reps"],
        targetSets: 3,
        plannedSets: [],
        lastTime: null,
      },
    ],
  };
}

export const nextFixture: WhatsNextResponse = {
  next: [
    {
      programId: ids.program,
      programName: "Push Pull Legs",
      workoutId: ids.workout,
      workoutName: "Push A",
      cycleNumber: 1,
    },
  ],
  inProgress: [],
};

/** A cycle's tree as `GET /programs/:id/cycles/:n` returns it, slots left out. */
export function cycleFixture(
  cycleNumber: number,
  workouts: { id: string; name: string }[],
): CycleDetailResponse {
  return {
    programId: ids.program,
    cycleNumber,
    fingerprint: "f".repeat(64),
    cycle: {
      id: newId(),
      workouts: workouts.map((w, position) => ({
        ...w,
        position,
        notes: null,
        plannedExercises: [],
        trained: false,
        trainedAt: null,
      })),
    },
  };
}

/**
 * The fixture program as an open-ended Push A, Pull A, Legs A cycle, so the
 * outline knows what follows Push A (`outline.ts`).
 */
export function withOutlineFixture(api: FakeServerApi): void {
  api.programsResponse = {
    programs: [
      {
        id: ids.program,
        name: "Push Pull Legs",
        status: "ACTIVE",
        targetCycles: null,
        currentCycle: 1,
      },
    ],
  };
  api.cycles.set(
    `${ids.program}/1`,
    cycleFixture(1, [
      { id: ids.workout, name: "Push A" },
      { id: ids.workout3, name: "Pull A" },
      { id: ids.workout2, name: "Legs A" },
    ]),
  );
}

export class FakeServerApi implements ServerApi {
  nextResponse: WhatsNextResponse = nextFixture;
  programsResponse: ProgramListResponse = { programs: [] };
  /** `programId/cycleNumber` -> the cycle; anything else is a 404. */
  readonly cycles = new Map<string, CycleDetailResponse>();
  failContext = new Set<string>();
  contextCalls: string[] = [];

  next = () => Promise.resolve(this.nextResponse);
  context = (workoutId: string) => {
    this.contextCalls.push(workoutId);
    if (this.failContext.has(workoutId)) {
      return Promise.reject(new ApiError(503, "/api/workouts", null));
    }
    return Promise.resolve(contextFor(workoutId));
  };
  templates = () => Promise.resolve({ templates: [] });
  startFromTemplate: ServerApi["startFromTemplate"] = () =>
    Promise.reject(new Error("not used"));
  history = () => Promise.resolve({ items: [], nextCursor: null });
  session: ServerApi["session"] = () => Promise.reject(new Error("not used"));
  programs = () => Promise.resolve(this.programsResponse);
  program: ServerApi["program"] = () => Promise.reject(new Error("not used"));
  cycle = (programId: string, cycleNumber: number) => {
    const cycle = this.cycles.get(`${programId}/${cycleNumber}`);
    return cycle
      ? Promise.resolve(cycle)
      : Promise.reject(
          new ApiError(404, "/api/programs", "That cycle doesn't exist."),
        );
  };
  renameProgram: ServerApi["renameProgram"] = () =>
    Promise.reject(new Error("not used"));
  copyProgram: ServerApi["copyProgram"] = () =>
    Promise.reject(new Error("not used"));
  activateProgram: ServerApi["activateProgram"] = () =>
    Promise.reject(new Error("not used"));
  archiveProgram: ServerApi["archiveProgram"] = () =>
    Promise.reject(new Error("not used"));
  extendProgram: ServerApi["extendProgram"] = () =>
    Promise.reject(new Error("not used"));
  createProgram: ServerApi["createProgram"] = () =>
    Promise.reject(new Error("not used"));
  applyPreview: ServerApi["applyPreview"] = () =>
    Promise.reject(new Error("not used"));
  saveCycle: ServerApi["saveCycle"] = () =>
    Promise.reject(new Error("not used"));
  exercises: ServerApi["exercises"] = () =>
    Promise.resolve({ exercises: [], units: { default: "LB", overrides: {} } });
  createExercise: ServerApi["createExercise"] = () =>
    Promise.reject(new Error("not used"));
  editExercise: ServerApi["editExercise"] = () =>
    Promise.reject(new Error("not used"));
  saveExerciseNotes: ServerApi["saveExerciseNotes"] = () =>
    Promise.reject(new Error("not used"));
  retireExercise: ServerApi["retireExercise"] = () =>
    Promise.reject(new Error("not used"));
  reactivateExercise: ServerApi["reactivateExercise"] = () =>
    Promise.reject(new Error("not used"));
}

interface ServerSet {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  weightUnit: string;
}

/**
 * Applies requests like the API would. `failWith` decides, per call, whether
 * to throw instead; `hold` makes a call wait until released, to observe what
 * the queue does while a request is on the wire.
 */
export class FakeServer {
  readonly calls: { request: Mutation; refreshToken: boolean }[] = [];
  /** Requests that reached the server and were applied, in order. */
  readonly applied: Mutation[] = [];
  readonly sessions = new Map<string, { workoutId: string; status: string }>();
  readonly sessionExercises = new Map<
    string,
    { sessionId: string; plannedExerciseId: string | null; position: number }
  >();
  readonly sets = new Map<string, ServerSet>();
  failWith:
    ((request: Mutation, refreshToken: boolean) => Error | null) | null = null;
  #holds: (() => void)[] = [];
  holdNext = false;

  transport: Transport = async (request, { refreshToken }) => {
    this.calls.push({ request, refreshToken });
    if (this.holdNext) {
      this.holdNext = false;
      await new Promise<void>((resolve) => this.#holds.push(resolve));
    }
    const error = this.failWith?.(request, refreshToken) ?? null;
    if (error) throw error;
    this.apply(request);
  };

  release(): void {
    this.#holds.shift()?.();
  }

  setsOf(plannedExerciseId: string): ServerSet[] {
    const se = [...this.sessionExercises].find(
      ([, v]) => v.plannedExerciseId === plannedExerciseId,
    )?.[0];
    return [...this.sets.values()]
      .filter((s) => s.sessionExerciseId === se)
      .sort((a, b) => a.setNumber - b.setNumber);
  }

  apply(request: Mutation): void {
    this.applied.push(request);
    const [, , resource, id, action] = request.path.split("/");
    if (!id) throw new Error(`Bad path ${request.path}`);
    if (resource === "sessions" && request.method === "PUT") {
      const body = startWorkoutRequest.parse(request.body);
      if (!this.sessions.has(id)) {
        this.sessions.set(id, {
          workoutId: body.workoutId,
          status: "IN_PROGRESS",
        });
      }
    } else if (resource === "workouts" && action === "skip") {
      const body = skipWorkoutRequest.parse(request.body);
      if (this.sessions.has(body.sessionId)) return;
      const other = [...this.sessions.values()].some((s) => s.workoutId === id);
      if (other) {
        throw new ApiError(
          409,
          request.path,
          "That workout is already started.",
        );
      }
      this.sessions.set(body.sessionId, { workoutId: id, status: "SKIPPED" });
    } else if (resource === "sessions" && action === "finish") {
      const session = this.sessions.get(id);
      if (!session) throw new ApiError(404, request.path, "No such session");
      session.status = "COMPLETED";
    } else if (resource === "sets" && request.method === "PUT") {
      const body = logSetRequest.parse(request.body);
      if (!this.sessions.has(body.sessionExercise.sessionId)) {
        throw new ApiError(
          404,
          request.path,
          "That workout session doesn't exist.",
        );
      }
      if (this.sets.has(id)) return;
      if (!this.sessionExercises.has(body.sessionExercise.id)) {
        this.sessionExercises.set(body.sessionExercise.id, {
          sessionId: body.sessionExercise.sessionId,
          plannedExerciseId: body.sessionExercise.plannedExerciseId,
          position: body.sessionExercise.position,
        });
      }
      const clash = [...this.sets.values()].some(
        (s) =>
          s.sessionExerciseId === body.sessionExercise.id &&
          s.setNumber === body.setNumber,
      );
      if (clash) throw new ApiError(409, request.path, "Set already logged");
      this.sets.set(id, {
        id,
        sessionExerciseId: body.sessionExercise.id,
        setNumber: body.setNumber,
        reps: body.reps,
        weight: body.weight,
        weightUnit: body.weightUnit ?? "LB",
      });
    } else if (resource === "sets" && request.method === "PATCH") {
      const body = editSetRequest.parse(request.body);
      const set = this.sets.get(id);
      if (!set)
        throw new ApiError(404, request.path, "That set doesn't exist.");
      set.reps = body.reps;
      set.weight = body.weight;
      if (body.weightUnit) set.weightUnit = body.weightUnit;
    } else if (resource === "sets" && request.method === "DELETE") {
      const set = this.sets.get(id);
      if (!set) return;
      this.sets.delete(id);
      const survivors = [...this.sets.values()]
        .filter((s) => s.sessionExerciseId === set.sessionExerciseId)
        .sort((a, b) => a.setNumber - b.setNumber);
      survivors.forEach((s, i) => (s.setNumber = i + 1));
      if (survivors.length === 0)
        this.sessionExercises.delete(set.sessionExerciseId);
    } else {
      throw new Error(`Unhandled ${request.method} ${request.path}`);
    }
  }
}

export class ManualTimers implements Timers {
  readonly pending: { callback: () => void; ms: number }[] = [];
  readonly scheduled: number[] = [];

  set = (callback: () => void, ms: number) => {
    const timer = { callback, ms };
    this.pending.push(timer);
    this.scheduled.push(ms);
    return timer;
  };

  clear = (handle: unknown) => {
    const i = this.pending.indexOf(handle as (typeof this.pending)[number]);
    if (i >= 0) this.pending.splice(i, 1);
  };

  /** Fires the earliest scheduled retry, as if its delay had passed. */
  fire(): void {
    const timer = this.pending.shift();
    if (!timer) throw new Error("No timer scheduled");
    timer.callback();
  }
}

export class FakeConnectivity implements Connectivity {
  online = true;
  readonly #listeners = new Set<() => void>();
  isOnline = () => this.online;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  set(online: boolean): void {
    this.online = online;
    for (const listener of this.#listeners) listener();
  }
}

/** Clerk's loaded/user signal, notified by hand (as `ClerkBridge` does). */
export class FakeAuth {
  ready = true;
  readonly #listeners = new Set<() => void>();
  isReady = () => this.ready;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

let dbCounter = 0;

/** A unique database name per test; reuse it to simulate a reload. */
export function freshDbName(): string {
  dbCounter += 1;
  return `tanren-test-${dbCounter}-${newId()}`;
}

export interface Harness {
  layer: DataLayer;
  server: FakeServer;
  api: FakeServerApi;
  timers: ManualTimers;
  connectivity: FakeConnectivity;
  dbName: string;
  clock: { now: Date };
}

/**
 * A started data layer over fake-indexeddb, signed in as `USER`. Pass a
 * previous harness's `dbName` (after `layer.close()`) to simulate a reload.
 */
export async function makeHarness(
  overrides: Partial<Omit<Harness, "layer">> & {
    currentUserId?: () => string | null | undefined;
    /** Clerk's auth signal; defaults to always ready, never notifying. */
    auth?: FakeAuth;
    /** `false`: don't record a last signed-in user (Clerk never reached ready). */
    signIn?: boolean;
    requestTimeoutMs?: number;
  } = {},
): Promise<Harness> {
  const server = overrides.server ?? new FakeServer();
  const api = overrides.api ?? new FakeServerApi();
  const timers = overrides.timers ?? new ManualTimers();
  const connectivity = overrides.connectivity ?? new FakeConnectivity();
  const dbName = overrides.dbName ?? freshDbName();
  const clock = overrides.clock ?? {
    now: new Date("2026-10-26T09:00:00.000Z"),
  };
  const db = await openLocalDb(dbName);
  const layer = new DataLayer(db, api, {
    api,
    dbName,
    // Like the real transport: offline, nothing reaches the server.
    transport: (request, options) =>
      connectivity.isOnline()
        ? server.transport(request, options)
        : Promise.reject(new OfflineError()),
    connectivity,
    auth: overrides.auth ?? new FakeAuth(),
    currentUserId: overrides.currentUserId ?? (() => USER),
    now: () => clock.now,
    timers,
    lock: (run) => run(),
    requestTimeoutMs: overrides.requestTimeoutMs,
  });
  await layer.start();
  await layer.queue.settled();
  if (overrides.signIn !== false && !layer.lastUser.getSnapshot()) {
    await layer.signedIn({
      userId: USER,
      email: "lifter+clerk_test@example.com",
    });
    await layer.queue.settled();
  }
  return { layer, server, api, timers, connectivity, dbName, clock };
}

/** Prefetches the fixture workout so a start works offline. */
export async function prefetch(h: Harness): Promise<void> {
  const { prefetched } = await h.layer.loadNext();
  await prefetched;
}
