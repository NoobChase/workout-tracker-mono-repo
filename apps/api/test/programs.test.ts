// The step-4a catalog and program routes (design D7, D10, D11) through the
// real app with fake services: each route calls the right service with the
// parsed input, maps its result and every ServiceError kind to a status, sits
// behind requireAuth, and -- for writes -- behind requirePro, checked before
// the request is parsed. What the services do to rows is packages/services'
// Neon tests.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { SubStatus, UserId } from "@workout-tracker/db";
import { ServiceError, type ServiceErrorKind } from "@workout-tracker/services";
import {
  copyProgramRequest,
  createExerciseRequest,
  createProgramRequest,
  editExerciseRequest,
  errorResponse,
  exerciseNotesRequest,
  extendProgramRequest,
  newId,
  renameProgramRequest,
  saveCycleRequest,
  workoutNode,
  type ExerciseListItem,
  type ProgramSummary,
} from "@workout-tracker/shared";
import type { Services } from "../src/services";
import { FAKE_DB, fakes, unfakedServices, viaCloudFront } from "./support";

const exerciseId = randomUUID();
const programId = newId();
const fp = "a".repeat(64);
const fp2 = "b".repeat(64);

const exercise: ExerciseListItem = {
  id: exerciseId,
  name: "Reverse Hyper",
  isCustom: true,
  isActive: true,
  primaryMuscles: ["GLUTES"],
  secondaryMuscles: ["HAMSTRINGS"],
  equipment: "MACHINE",
  metrics: [{ metric: "REPS", isRequired: true }],
  setup: null,
  cues: null,
};
const program: ProgramSummary = {
  id: programId,
  name: "Summer Strength",
  status: "DRAFT",
  targetCycles: 4,
  currentCycle: 1,
};

const tree = {
  id: newId(),
  workouts: [
    {
      id: newId(),
      name: "Push",
      position: 0,
      plannedExercises: [
        { id: newId(), exerciseId, position: 0, targetSets: 3 },
        {
          id: newId(),
          placeholderLabel: "finisher",
          position: 1,
          targetSets: 1,
        },
      ],
    },
  ],
};

const bodies = {
  createExercise: {
    id: newId(),
    name: "Reverse Hyper",
    primaryMuscles: ["GLUTES"],
    metrics: [{ metric: "REPS", isRequired: true }],
  },
  editExercise: { name: "Reverse Hyperextension" },
  notes: { id: newId(), setup: "pin 4", cues: "" },
  createProgram: {
    programId,
    name: "Summer Strength",
    targetCycles: 4,
    cycle: tree,
  },
  rename: { name: "Winter Strength" },
  save: {
    cycle: tree,
    expected: { source: fp },
    applyTo: [{ cycleNumber: 2, fingerprint: fp }],
  },
  copy: { newProgramId: newId(), name: "Summer Strength (2)" },
  extend: { newPlanId: newId() },
};

/** Services that answer with valid payloads and record how they were called. */
function recordingServices(overrides: Partial<Services> = {}) {
  const calls: { name: keyof Services; args: unknown[] }[] = [];
  const record = <K extends keyof Services>(
    name: K,
    result: Awaited<ReturnType<Services[K]>>,
  ) =>
    ((...args: unknown[]) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    }) as Services[K];
  const one = { exercise };
  const services: Services = {
    ...unfakedServices(),
    listExercises: record("listExercises", {
      exercises: [exercise],
      units: { default: "LB", overrides: {} },
    }),
    createExercise: record("createExercise", one),
    editExercise: record("editExercise", one),
    saveExerciseNotes: record("saveExerciseNotes", one),
    retireExercise: record("retireExercise", one),
    reactivateExercise: record("reactivateExercise", one),
    listPrograms: record("listPrograms", { programs: [program] }),
    createProgram: record("createProgram", { program }),
    getProgram: record("getProgram", {
      program,
      cycles: [
        { cycleNumber: 1, trained: true, fullyTrained: false },
        { cycleNumber: 2, trained: false, fullyTrained: false },
      ],
    }),
    getCycle: record("getCycle", {
      programId,
      cycleNumber: 2,
      // The load fingerprint the builder sends back as `expected.source`:
      // the route's response parse must keep it.
      fingerprint: fp,
      cycle: {
        id: tree.id,
        workouts: tree.workouts.map((w) => ({
          ...workoutNode.parse(w),
          trained: true,
          trainedAt: "2026-03-02T09:30:00.000Z",
        })),
      },
    }),
    renameProgram: record("renameProgram", { program }),
    copyProgram: record("copyProgram", { program }),
    activateProgram: record("activateProgram", {
      program: { ...program, status: "ACTIVE" },
    }),
    archiveProgram: record("archiveProgram", {
      program: { ...program, status: "ARCHIVED" },
    }),
    extendProgram: record("extendProgram", {
      program: { ...program, status: "ACTIVE", targetCycles: 5 },
    }),
    getApplyPreview: record("getApplyPreview", {
      cycleNumber: 1,
      source: fp,
      later: [
        { cycleNumber: 2, fingerprint: fp, trained: false, matches: true },
        { cycleNumber: 3, fingerprint: fp2, trained: false, matches: false },
      ],
    }),
    saveCycle: record("saveCycle", { cycleNumber: 1, applied: [2] }),
    ...overrides,
  };
  return { services, calls };
}

interface Route {
  label: string;
  method: string;
  path: string;
  body?: unknown;
  service: keyof Services;
  status: number;
  write: boolean;
  /** The service arguments after `(db, user)`: what the route parsed. */
  args: unknown[];
}

const ex = `/api/exercises/${exerciseId}`;
const pr = `/api/programs/${programId}`;

const routes: Route[] = [
  {
    label: "GET /exercises",
    method: "GET",
    path: "/api/exercises",
    service: "listExercises",
    status: 200,
    write: false,
    args: [{ includeRetired: false }],
  },
  {
    label: "GET /exercises?includeRetired=1",
    method: "GET",
    path: "/api/exercises?includeRetired=1",
    service: "listExercises",
    status: 200,
    write: false,
    args: [{ includeRetired: true }],
  },
  {
    label: "POST /exercises",
    method: "POST",
    path: "/api/exercises",
    body: bodies.createExercise,
    service: "createExercise",
    status: 201,
    write: true,
    args: [createExerciseRequest.parse(bodies.createExercise)],
  },
  {
    label: "PATCH /exercises/:id",
    method: "PATCH",
    path: ex,
    body: bodies.editExercise,
    service: "editExercise",
    status: 200,
    write: true,
    args: [exerciseId, editExerciseRequest.parse(bodies.editExercise)],
  },
  {
    label: "PUT /exercises/:id/notes",
    method: "PUT",
    path: `${ex}/notes`,
    body: bodies.notes,
    service: "saveExerciseNotes",
    status: 200,
    write: true,
    args: [exerciseId, exerciseNotesRequest.parse(bodies.notes)],
  },
  {
    label: "POST /exercises/:id/retire",
    method: "POST",
    path: `${ex}/retire`,
    service: "retireExercise",
    status: 200,
    write: true,
    args: [exerciseId],
  },
  {
    label: "POST /exercises/:id/reactivate",
    method: "POST",
    path: `${ex}/reactivate`,
    service: "reactivateExercise",
    status: 200,
    write: true,
    args: [exerciseId],
  },
  {
    label: "GET /programs",
    method: "GET",
    path: "/api/programs",
    service: "listPrograms",
    status: 200,
    write: false,
    args: [],
  },
  {
    label: "POST /programs",
    method: "POST",
    path: "/api/programs",
    body: bodies.createProgram,
    service: "createProgram",
    status: 201,
    write: true,
    args: [createProgramRequest.parse(bodies.createProgram)],
  },
  {
    label: "GET /programs/:id",
    method: "GET",
    path: pr,
    service: "getProgram",
    status: 200,
    write: false,
    args: [programId],
  },
  {
    label: "PATCH /programs/:id",
    method: "PATCH",
    path: pr,
    body: bodies.rename,
    service: "renameProgram",
    status: 200,
    write: true,
    args: [programId, renameProgramRequest.parse(bodies.rename)],
  },
  {
    label: "GET /programs/:id/cycles/:n",
    method: "GET",
    path: `${pr}/cycles/2`,
    service: "getCycle",
    status: 200,
    write: false,
    args: [programId, 2],
  },
  {
    label: "GET /programs/:id/cycles/:n/apply-preview",
    method: "GET",
    path: `${pr}/cycles/1/apply-preview`,
    service: "getApplyPreview",
    status: 200,
    write: false,
    args: [programId, 1],
  },
  {
    label: "PUT /programs/:id/cycles/:n",
    method: "PUT",
    path: `${pr}/cycles/1`,
    body: bodies.save,
    service: "saveCycle",
    status: 200,
    write: true,
    args: [programId, 1, saveCycleRequest.parse(bodies.save)],
  },
  {
    label: "POST /programs/:id/copy",
    method: "POST",
    path: `${pr}/copy`,
    body: bodies.copy,
    service: "copyProgram",
    status: 201,
    write: true,
    args: [programId, copyProgramRequest.parse(bodies.copy)],
  },
  {
    label: "POST /programs/:id/activate",
    method: "POST",
    path: `${pr}/activate`,
    service: "activateProgram",
    status: 200,
    write: true,
    args: [programId],
  },
  {
    label: "POST /programs/:id/archive",
    method: "POST",
    path: `${pr}/archive`,
    service: "archiveProgram",
    status: 200,
    write: true,
    args: [programId],
  },
  {
    label: "POST /programs/:id/extend",
    method: "POST",
    path: `${pr}/extend`,
    body: bodies.extend,
    service: "extendProgram",
    status: 200,
    write: true,
    args: [programId, extendProgramRequest.parse(bodies.extend)],
  },
];

const init = (
  route: Route,
  token?: string,
  body = route.body,
): RequestInit => ({
  method: route.method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** An app whose `user_a` has the given status; billing treated as live. */
function setup(subStatus: SubStatus, overrides?: Partial<Services>) {
  const { services, calls } = recordingServices(overrides);
  const { deps, users } = fakes(services);
  const userId = randomUUID() as UserId;
  users.set("user_a", { id: userId, subStatus, deletedAt: null });
  return { app: viaCloudFront(deps, { proBypass: false }), calls, userId };
}

const lapsed: SubStatus[] = ["NONE", "PAST_DUE", "CANCELED"];

describe("catalog and program routes", () => {
  beforeEach(() => mock.method(console, "error", () => undefined));
  afterEach(() => mock.restoreAll());

  describe("success", () => {
    for (const route of routes) {
      it(`${route.label} -> ${route.status} with the service's result, one call scoped to the user`, async () => {
        const { app, calls, userId } = setup("ACTIVE");
        const { services } = recordingServices();
        const expected = await (
          services[route.service] as () => Promise<unknown>
        )();

        const res = await app.request(route.path, init(route, "valid:user_a"));

        assert.equal(res.status, route.status);
        assert.deepEqual(await res.json(), expected);
        assert.deepEqual(calls, [
          { name: route.service, args: [FAKE_DB, userId, ...route.args] },
        ]);
      });
    }
  });

  describe("authentication", () => {
    for (const route of routes) {
      it(`${route.label} -> 401 without a token`, async () => {
        const { app, calls } = setup("ACTIVE");
        const res = await app.request(route.path, init(route));
        assert.equal(res.status, 401);
        assert.deepEqual(calls, []);
      });
    }
  });

  describe("the Pro gate (billing live)", () => {
    for (const route of routes.filter((r) => r.write)) {
      it(`${route.label} -> 403 for a lapsed account, ${route.status} for TRIALING and ACTIVE`, async () => {
        for (const status of lapsed) {
          const { app, calls } = setup(status);
          const res = await app.request(
            route.path,
            init(route, "valid:user_a"),
          );
          assert.equal(res.status, 403, status);
          assert.deepEqual(await res.json(), {
            ok: false,
            error: "pro subscription required",
          });
          assert.deepEqual(calls, [], status);
        }
        for (const status of ["TRIALING", "ACTIVE"] as const) {
          const { app } = setup(status);
          const res = await app.request(
            route.path,
            init(route, "valid:user_a"),
          );
          assert.equal(res.status, route.status, status);
        }
      });

      it(`${route.label} checks entitlement before the request is parsed`, async () => {
        const { app } = setup("CANCELED");
        const res = await app.request(
          route.path.replace(/[0-9a-f-]{36}/, "nope"),
          {
            method: route.method,
            headers: { Authorization: "Bearer valid:user_a" },
            body: route.body === undefined ? undefined : "not json",
          },
        );
        assert.equal(res.status, 403);
      });
    }

    for (const route of routes.filter((r) => !r.write)) {
      it(`${route.label} stays readable for a lapsed account`, async () => {
        for (const status of lapsed) {
          const { app } = setup(status);
          const res = await app.request(
            route.path,
            init(route, "valid:user_a"),
          );
          assert.equal(res.status, route.status, status);
        }
      });
    }
  });

  describe("service errors", () => {
    const expected: Record<ServiceErrorKind, number> = {
      not_found: 404,
      invalid: 400,
      conflict: 409,
      forbidden: 403,
    };

    for (const route of routes) {
      it(`${route.label} maps every ServiceError kind, message verbatim`, async () => {
        for (const [kind, status] of Object.entries(expected) as [
          ServiceErrorKind,
          number,
        ][]) {
          const message = `${route.label}: a ${kind} message.`;
          const { app } = setup("ACTIVE", {
            [route.service]: () =>
              Promise.reject(new ServiceError(kind, message)),
          });
          const res = await app.request(
            route.path,
            init(route, "valid:user_a"),
          );
          assert.equal(res.status, status, kind);
          assert.deepEqual(errorResponse.parse(await res.json()), {
            ok: false,
            error: message,
          });
        }
      });
    }

    it("a result that breaks the contract is a 500, not a bad payload", async () => {
      const { app } = setup("ACTIVE", {
        getApplyPreview: () =>
          Promise.resolve({ cycleNumber: 1, source: "x", later: [] }),
      });
      const route = routes.find((r) => r.service === "getApplyPreview")!;
      const res = await app.request(route.path, init(route, "valid:user_a"));
      assert.equal(res.status, 500);
    });
  });

  describe("validation", () => {
    async function assertBadRequest(
      method: string,
      path: string,
      body?: unknown,
    ) {
      const { app, calls } = setup("ACTIVE");
      const res = await app.request(path, {
        method,
        headers: {
          Authorization: "Bearer valid:user_a",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const label = `${method} ${path} ${JSON.stringify(body)}`;
      assert.equal(res.status, 400, label);
      assert.match(errorResponse.parse(await res.json()).error, /^Invalid /);
      assert.deepEqual(calls, [], label);
    }

    it("every path id must be a uuid", async () => {
      for (const route of routes.filter((r) => /[0-9a-f-]{36}/.test(r.path))) {
        await assertBadRequest(
          route.method,
          route.path.replace(/[0-9a-f-]{36}/, "nope"),
          route.body,
        );
      }
    });

    it("the cycle number must be a positive whole number", async () => {
      for (const n of ["0", "-1", "1.5", "x", "01"]) {
        await assertBadRequest("GET", `${pr}/cycles/${n}`);
        await assertBadRequest("GET", `${pr}/cycles/${n}/apply-preview`);
        await assertBadRequest("PUT", `${pr}/cycles/${n}`, bodies.save);
      }
    });

    it("rejects bodies the shared schemas reject", async () => {
      const cases: [string, string, unknown][] = [
        ["GET", "/api/exercises?includeRetired=yes", undefined],
        ["POST", "/api/exercises", { ...bodies.createExercise, metrics: [] }],
        [
          "POST",
          "/api/exercises",
          { ...bodies.createExercise, id: randomUUID() },
        ],
        ["PATCH", ex, { metrics: [{ metric: "REPS", isRequired: true }] }],
        ["PATCH", ex, {}],
        ["PUT", `${ex}/notes`, { ...bodies.notes, id: randomUUID() }],
        ["POST", "/api/programs", { ...bodies.createProgram, targetCycles: 0 }],
        ["POST", "/api/programs", { ...bodies.createProgram, name: " " }],
        [
          "POST",
          "/api/programs",
          { ...bodies.createProgram, cycle: { ...tree, workouts: [] } },
        ],
        ["PATCH", pr, { name: "" }],
        ["PUT", `${pr}/cycles/1`, { ...bodies.save, applyTo: [2, 3] }],
        [
          "PUT",
          `${pr}/cycles/1`,
          {
            ...bodies.save,
            applyTo: [
              { cycleNumber: 2, fingerprint: fp },
              { cycleNumber: 2, fingerprint: fp },
            ],
          },
        ],
        ["POST", `${pr}/copy`, { newProgramId: randomUUID() }],
        ["POST", `${pr}/extend`, { newPlanId: randomUUID() }],
      ];
      for (const [method, path, body] of cases) {
        await assertBadRequest(method, path, body);
      }
    });

    it("rejects a missing or non-JSON body on every write that takes one", async () => {
      for (const route of routes.filter((r) => r.body !== undefined)) {
        for (const body of [undefined, "not json"]) {
          const { app, calls } = setup("ACTIVE");
          const res = await app.request(route.path, {
            method: route.method,
            headers: { Authorization: "Bearer valid:user_a" },
            body,
          });
          assert.equal(res.status, 400, route.label);
          assert.deepEqual(calls, [], route.label);
        }
      }
    });
  });

  describe("idempotency", () => {
    it("every write reaches its service with identical arguments on a retry, and answers the same", async () => {
      for (const route of routes.filter((r) => r.write)) {
        const { app, calls } = setup("ACTIVE");
        const a = await app.request(route.path, init(route, "valid:user_a"));
        const b = await app.request(route.path, init(route, "valid:user_a"));
        assert.equal(a.status, route.status, route.label);
        assert.equal(b.status, route.status, route.label);
        assert.equal(calls.length, 2, route.label);
        assert.deepEqual(calls[1], calls[0], route.label);
        assert.equal(await b.text(), await a.text(), route.label);
      }
    });

    it("POST /programs twice: one program, equal responses", async () => {
      // The contract's behaviour (insert ON CONFLICT DO NOTHING, recognise
      // the replay); the real one is tested against Neon.
      const rows = new Map<string, ProgramSummary>();
      const { app } = setup("ACTIVE", {
        createProgram: (_db, _user, input) => {
          if (!rows.has(input.programId)) {
            rows.set(input.programId, {
              id: input.programId,
              name: input.name,
              status: "DRAFT",
              targetCycles: input.targetCycles,
              currentCycle: 1,
            });
          }
          return Promise.resolve({ program: rows.get(input.programId)! });
        },
      });
      const route = routes.find((r) => r.service === "createProgram")!;

      const first = await app.request(route.path, init(route, "valid:user_a"));
      const second = await app.request(route.path, init(route, "valid:user_a"));

      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.deepEqual(await second.json(), await first.json());
      assert.equal(rows.size, 1);
    });

    it("POST /exercises twice: one exercise, equal responses", async () => {
      const rows = new Map<string, ExerciseListItem>();
      const { app } = setup("ACTIVE", {
        createExercise: (_db, _user, input) => {
          if (!rows.has(input.id)) {
            rows.set(input.id, { ...exercise, id: input.id, name: input.name });
          }
          return Promise.resolve({ exercise: rows.get(input.id)! });
        },
      });
      const route = routes.find((r) => r.service === "createExercise")!;

      const first = await app.request(route.path, init(route, "valid:user_a"));
      const second = await app.request(route.path, init(route, "valid:user_a"));

      assert.equal(first.status, 201);
      assert.deepEqual(await second.json(), await first.json());
      assert.equal(rows.size, 1);
    });
  });
});
