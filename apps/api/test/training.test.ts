// The step 3 routes through the real app with fake services: status codes,
// error mapping, validation, auth and the Pro gate on writes. What the services
// do to rows is packages/services' integration tests; what is pinned here is
// that each route calls the right one with the right arguments and nothing
// else.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { SubStatus, UserId } from "@workout-tracker/db";
import { ServiceError, type ServiceErrorKind } from "@workout-tracker/services";
import {
  errorResponse,
  newId,
  type LoggedSet,
  type StartedSession,
} from "@workout-tracker/shared";
import type { Services } from "../src/services";
import { FAKE_DB, bearer, fakes, viaCloudFront } from "./support";

const NOW = "2026-10-26T12:00:00.000Z";

const sessionId = newId();
const workoutId = newId();
const setId = newId();
const programId = newId();

const startBody = { workoutId, performedAt: NOW };
const logBody = {
  sessionExercise: {
    id: newId(),
    sessionId,
    exerciseId: randomUUID(),
    plannedExerciseId: newId(),
    position: 0,
  },
  setNumber: 1,
  reps: 8,
  weight: 135,
  weightUnit: "LB",
  loggedAt: NOW,
};
const editBody = { reps: 6, weight: 140 };

const stored: LoggedSet = {
  id: setId,
  sessionExerciseId: logBody.sessionExercise.id,
  setNumber: 1,
  reps: 8,
  weight: 135,
  weightUnit: "LB",
  kind: "NORMAL",
  loggedAt: NOW,
};
const startedSession: StartedSession = {
  id: sessionId,
  workoutId,
  status: "IN_PROGRESS",
  performedAt: NOW,
};

interface Call {
  name: keyof Services;
  args: unknown[];
}

/** Services that answer with valid payloads and record how they were called. */
function recordingServices(overrides: Partial<Services> = {}) {
  const calls: Call[] = [];
  const record = <K extends keyof Services>(
    name: K,
    result: Awaited<ReturnType<Services[K]>>,
  ) =>
    ((...args: unknown[]) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    }) as Services[K];
  const services: Services = {
    listTemplates: record("listTemplates", { templates: [] }),
    startProgramFromTemplate: record("startProgramFromTemplate", {
      program: {
        id: programId,
        name: "PPL",
        status: "ACTIVE",
        targetCycles: null,
      },
    }),
    whatsNext: record("whatsNext", { next: [], inProgress: [] }),
    getWorkoutContext: record("getWorkoutContext", {
      workout: {
        id: workoutId,
        name: "Push",
        position: 0,
        cycleNumber: 1,
        programId,
        programName: "PPL",
      },
      units: { default: "LB", overrides: {} },
      exercises: [],
    }),
    startWorkout: record("startWorkout", startedSession),
    finishWorkout: record("finishWorkout", {
      sessionId,
      status: "COMPLETED",
      extended: false,
    }),
    getSession: record("getSession", {
      session: {
        id: sessionId,
        workoutId,
        workoutName: "Push",
        programName: "PPL",
        cycleNumber: 1,
        performedAt: NOW,
        status: "IN_PROGRESS",
      },
      exercises: [],
    }),
    logSet: record("logSet", stored),
    editSet: record("editSet", { ...stored, reps: 6, weight: 140 }),
    deleteSet: record("deleteSet", undefined),
    getWorkoutHistory: record("getWorkoutHistory", {
      items: [],
      nextCursor: null,
    }),
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
  /** The service arguments after `(db, user)`. */
  args: unknown[];
}

const routes: Route[] = [
  {
    label: "GET /templates",
    method: "GET",
    path: "/api/templates",
    service: "listTemplates",
    status: 200,
    write: false,
    args: [],
  },
  {
    label: "POST /programs/from-template",
    method: "POST",
    path: "/api/programs/from-template",
    body: { programId, templateSlug: "ppl" },
    service: "startProgramFromTemplate",
    status: 200,
    write: true,
    args: [{ programId, templateSlug: "ppl" }],
  },
  {
    label: "GET /next",
    method: "GET",
    path: "/api/next",
    service: "whatsNext",
    status: 200,
    write: false,
    args: [],
  },
  {
    label: "GET /workouts/:id/context",
    method: "GET",
    path: `/api/workouts/${workoutId}/context`,
    service: "getWorkoutContext",
    status: 200,
    write: false,
    args: [workoutId],
  },
  {
    label: "PUT /sessions/:id",
    method: "PUT",
    path: `/api/sessions/${sessionId}`,
    body: startBody,
    service: "startWorkout",
    status: 200,
    write: true,
    args: [sessionId, startBody],
  },
  {
    label: "POST /sessions/:id/finish",
    method: "POST",
    path: `/api/sessions/${sessionId}/finish`,
    service: "finishWorkout",
    status: 200,
    write: true,
    args: [sessionId],
  },
  {
    label: "GET /sessions/:id",
    method: "GET",
    path: `/api/sessions/${sessionId}`,
    service: "getSession",
    status: 200,
    write: false,
    args: [sessionId],
  },
  {
    label: "PUT /sets/:id",
    method: "PUT",
    path: `/api/sets/${setId}`,
    body: logBody,
    service: "logSet",
    status: 200,
    write: true,
    args: [setId, logBody],
  },
  {
    label: "PATCH /sets/:id",
    method: "PATCH",
    path: `/api/sets/${setId}`,
    body: editBody,
    service: "editSet",
    status: 200,
    write: true,
    args: [setId, editBody],
  },
  {
    label: "DELETE /sets/:id",
    method: "DELETE",
    path: `/api/sets/${setId}`,
    service: "deleteSet",
    status: 204,
    write: true,
    args: [setId],
  },
  {
    label: "GET /history",
    method: "GET",
    path: "/api/history",
    service: "getWorkoutHistory",
    status: 200,
    write: false,
    args: [{ cursor: undefined }],
  },
];

const init = (route: Route, token?: string): RequestInit => ({
  method: route.method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(route.body === undefined ? {} : { "content-type": "application/json" }),
  },
  ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
});

/** An app whose `user_a` has the given status; billing treated as live. */
function setup(subStatus: SubStatus, overrides?: Partial<Services>) {
  const { services, calls } = recordingServices(overrides);
  const { deps, users } = fakes(services);
  const userId = randomUUID() as UserId;
  users.set("user_a", { id: userId, subStatus, deletedAt: null });
  return {
    app: viaCloudFront(deps, { proBypass: false }),
    calls,
    userId,
  };
}

describe("training routes", () => {
  // Server faults are logged by the error handler; keep the test output quiet.
  beforeEach(() => mock.method(console, "error", () => undefined));
  afterEach(() => mock.restoreAll());

  describe("success", () => {
    for (const route of routes) {
      it(`${route.label} -> ${route.status}, one service call scoped to the user`, async () => {
        const { app, calls, userId } = setup("ACTIVE");
        const res = await app.request(route.path, init(route, "valid:user_a"));

        assert.equal(res.status, route.status);
        assert.deepEqual(calls, [
          {
            name: route.service,
            args: [FAKE_DB, userId, ...route.args],
          },
        ]);
        if (route.status === 204) assert.equal(await res.text(), "");
      });
    }

    it("passes the history cursor through", async () => {
      const { app, calls } = setup("ACTIVE");
      const res = await app.request(
        "/api/history?cursor=abc",
        bearer("valid:user_a"),
      );
      assert.equal(res.status, 200);
      assert.equal((calls[0]!.args[2] as { cursor: string }).cursor, "abc");
    });

    it("responds with the service's result", async () => {
      const { app } = setup("ACTIVE");
      const route = routes.find((r) => r.service === "logSet")!;
      const res = await app.request(route.path, init(route, "valid:user_a"));
      assert.deepEqual(await res.json(), stored);
    });
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
    const lapsed: SubStatus[] = ["NONE", "PAST_DUE", "CANCELED"];

    for (const route of routes.filter((r) => r.write)) {
      it(`${route.label} -> 403 for a lapsed account, 2xx for TRIALING and ACTIVE`, async () => {
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
        const res = await app.request(route.path, {
          method: route.method,
          headers: { Authorization: "Bearer valid:user_a" },
          body: route.body === undefined ? undefined : "not json",
        });
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

    it("production wiring still entitles everyone until step 5", async () => {
      const { services } = recordingServices();
      const { deps, users } = fakes(services);
      users.set("user_a", {
        id: randomUUID() as UserId,
        subStatus: "NONE",
        deletedAt: null,
      });
      // No options: what lambda.ts builds.
      const app = viaCloudFront(deps);
      const route = routes.find((r) => r.service === "logSet")!;
      const res = await app.request(route.path, init(route, "valid:user_a"));
      assert.equal(res.status, 200);
    });
  });

  describe("service errors", () => {
    const expected: Record<ServiceErrorKind, number> = {
      not_found: 404,
      invalid: 400,
      conflict: 409,
      forbidden: 403,
    };

    for (const [kind, status] of Object.entries(expected) as [
      ServiceErrorKind,
      number,
    ][]) {
      it(`${kind} -> ${status} with the message verbatim`, async () => {
        const message = `That is a ${kind} message.`;
        const refuse = () => Promise.reject(new ServiceError(kind, message));
        const { app } = setup("ACTIVE", { logSet: refuse, whatsNext: refuse });

        const write = routes.find((r) => r.service === "logSet")!;
        const wrote = await app.request(
          write.path,
          init(write, "valid:user_a"),
        );
        assert.equal(wrote.status, status);
        const body = await wrote.json();
        assert.deepEqual(errorResponse.parse(body), {
          ok: false,
          error: message,
        });

        // Reads take the same road.
        const read = await app.request("/api/next", bearer("valid:user_a"));
        assert.equal(read.status, status);
      });
    }

    it("anything else -> 500 with a generic body, never the internals", async () => {
      const { app } = setup("ACTIVE", {
        logSet: () => Promise.reject(new Error("connection reset by peer")),
      });
      const route = routes.find((r) => r.service === "logSet")!;
      const res = await app.request(route.path, init(route, "valid:user_a"));
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), {
        ok: false,
        error: "internal server error",
      });
    });

    it("a service result that breaks the contract is a 500, not a bad payload", async () => {
      const { app } = setup("ACTIVE", {
        whatsNext: () => Promise.resolve({ next: "nope" } as never),
      });
      const res = await app.request("/api/next", bearer("valid:user_a"));
      assert.equal(res.status, 500);
    });
  });

  describe("validation", () => {
    const put = (path: string, body: unknown = startBody) => ({
      path,
      init: {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid:user_a",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    });

    async function assertBadRequest(
      req: { path: string; init: RequestInit },
      calls: Call[],
    ) {
      const { app } = setup("ACTIVE");
      const res = await app.request(req.path, req.init);
      assert.equal(res.status, 400);
      const body = errorResponse.parse(await res.json());
      assert.ok(body.error.length > 0);
      assert.deepEqual(calls, []);
    }

    it("PUT /sessions/:id and PUT /sets/:id need a v7 id", async () => {
      for (const [path, body] of [
        [`/api/sessions/${randomUUID()}`, startBody],
        [`/api/sessions/not-a-uuid`, startBody],
        [`/api/sets/${randomUUID()}`, logBody],
      ] as const) {
        const { app, calls } = setup("ACTIVE");
        const res = await app.request(path, put(path, body).init);
        assert.equal(res.status, 400, path);
        errorResponse.parse(await res.json());
        assert.deepEqual(calls, [], path);
      }
    });

    it("the other path ids need a well-formed uuid", async () => {
      const bad = [
        { method: "GET", path: "/api/workouts/nope/context" },
        { method: "GET", path: "/api/sessions/nope" },
        { method: "POST", path: "/api/sessions/nope/finish" },
        { method: "DELETE", path: "/api/sets/nope" },
      ];
      for (const { method, path } of bad) {
        const { app, calls } = setup("ACTIVE");
        const res = await app.request(path, {
          method,
          headers: { Authorization: "Bearer valid:user_a" },
        });
        assert.equal(res.status, 400, `${method} ${path}`);
        assert.deepEqual(calls, []);
      }
      const { app, calls } = setup("ACTIVE");
      const res = await app.request("/api/sets/nope", {
        ...put("/api/sets/nope", editBody).init,
        method: "PATCH",
      });
      assert.equal(res.status, 400);
      assert.deepEqual(calls, []);
    });

    it("a v4 id is accepted where any uuid is", async () => {
      const { app } = setup("ACTIVE");
      const res = await app.request(
        `/api/sessions/${randomUUID()}`,
        bearer("valid:user_a"),
      );
      assert.equal(res.status, 200);
    });

    it("rejects bodies the shared schemas reject", async () => {
      const { app, calls } = setup("ACTIVE");
      const cases: [string, string, unknown][] = [
        ["PUT", `/api/sessions/${sessionId}`, { workoutId }],
        ["PUT", `/api/sets/${setId}`, { ...logBody, reps: -1 }],
        ["PUT", `/api/sets/${setId}`, { ...logBody, weightUnit: "STONE" }],
        ["PATCH", `/api/sets/${setId}`, { reps: 1.5, weight: 1 }],
        ["POST", "/api/programs/from-template", { templateSlug: "ppl" }],
        [
          "POST",
          "/api/programs/from-template",
          { programId: randomUUID(), templateSlug: "ppl" },
        ],
      ];
      for (const [method, path, body] of cases) {
        const res = await app.request(path, {
          method,
          headers: {
            Authorization: "Bearer valid:user_a",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        assert.equal(
          res.status,
          400,
          `${method} ${path} ${JSON.stringify(body)}`,
        );
        const parsed = errorResponse.parse(await res.json());
        assert.match(parsed.error, /^Invalid /);
      }
      assert.deepEqual(calls, []);
    });

    it("rejects a missing or non-JSON body", async () => {
      const { calls } = setup("ACTIVE");
      for (const body of [undefined, "not json"]) {
        await assertBadRequest(
          {
            path: `/api/sessions/${sessionId}`,
            init: {
              method: "PUT",
              headers: { Authorization: "Bearer valid:user_a" },
              body,
            },
          },
          calls,
        );
      }
    });
  });

  describe("idempotency", () => {
    it("PUT /sets/:id twice: one stored set, equal responses", async () => {
      // A service with the contract's behaviour (insert ON CONFLICT DO NOTHING,
      // then read back); the real one is tested against Neon. What this pins is
      // that the route is a pure pass-through of the path id and body, so a
      // retried request reaches the service as the same call.
      const rows = new Map<string, LoggedSet>();
      const { app } = setup("ACTIVE", {
        logSet: (_db, _user, id, input) => {
          if (!rows.has(id)) {
            rows.set(id, { ...stored, id, setNumber: input.setNumber });
          }
          return Promise.resolve(rows.get(id)!);
        },
      });
      const route = routes.find((r) => r.service === "logSet")!;

      const first = await app.request(route.path, init(route, "valid:user_a"));
      const second = await app.request(route.path, init(route, "valid:user_a"));

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), await first.json());
      assert.equal(rows.size, 1);
    });

    it("every write reaches its service with identical arguments on a retry", async () => {
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
  });
});
