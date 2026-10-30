import { uuidV7, type SessionDetailResponse } from "@workout-tracker/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../api.js";
import {
  contextFor,
  FakeConnectivity,
  ids,
  makeHarness,
  prefetch,
  type Harness,
  FakeAuth,
  USER,
} from "../test/fakes.js";
import { buildSessionView } from "./session-view.js";
import { LocalSessionError } from "./sessions.js";
import { deriveRowSync } from "./sync-state.js";

let harnesses: Harness[] = [];
async function harness(...args: Parameters<typeof makeHarness>) {
  const h = await makeHarness(...args);
  harnesses.push(h);
  return h;
}
afterEach(() => {
  for (const h of harnesses) h.layer.close();
  harnesses = [];
});

const bench = ids.bench.planned;
const frontSquat = ids.frontSquat.planned;

/** The logger's view of a session, exactly as `useSessionRecord` builds it. */
function view(h: Harness, sessionId: string) {
  const record = h.layer.sessions.get(sessionId);
  if (!record) return null;
  const rows = deriveRowSync(
    h.layer.queue.getState().items,
    h.connectivity.isOnline(),
  );
  return buildSessionView(record, rows);
}

function benchSets(h: Harness, sessionId: string) {
  return view(h, sessionId)!.exercises[0]!.sets;
}

/** Started offline from the prefetched context, so nothing is sent yet. */
async function offlineSession(h: Harness) {
  await prefetch(h);
  h.connectivity.set(false);
  return h.layer.sessions.start(ids.workout);
}

describe("local session record", () => {
  it("starts offline from the prefetched context: one queued start, nothing else", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);

    expect(uuidV7.safeParse(sessionId).success).toBe(true);
    const record = h.layer.sessions.get(sessionId)!;
    expect(record).toMatchObject({
      status: "IN_PROGRESS",
      workoutId: ids.workout,
      performedAt: "2026-10-26T09:00:00.000Z",
      exercises: [],
    });
    expect(record.context.exercises[0]?.lastTime?.sets[0]?.weight).toBe(225);
    const items = h.layer.queue.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      op: "start",
      request: {
        method: "PUT",
        path: `/api/sessions/${sessionId}`,
        body: {
          workoutId: ids.workout,
          performedAt: "2026-10-26T09:00:00.000Z",
        },
      },
    });
    expect(view(h, sessionId)!.sync.state).toBe("queued-no-signal");
  });

  it("can't start offline a workout that was never prefetched", async () => {
    const h = await harness();
    h.connectivity.set(false);
    h.api.failContext.add(ids.workout2);
    await expect(h.layer.sessions.start(ids.workout2)).rejects.toMatchObject({
      code: "no-context",
    });
    expect(h.layer.queue.getState().items).toEqual([]);
  });

  it("logs the first set with its session exercise, then numbers later sets in order", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    const first = await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 8,
      weight: 135,
    });
    h.clock.now = new Date("2026-10-26T09:03:00.000Z");
    const second = await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 7,
      weight: 135,
    });

    const [, log1, log2] = h.layer.queue.getState().items;
    const se = (log1?.request.body as { sessionExercise: { id: string } })
      .sessionExercise;
    expect(uuidV7.safeParse(first).success).toBe(true);
    expect(uuidV7.safeParse(se.id).success).toBe(true);
    expect(log1?.request).toMatchObject({
      method: "PUT",
      path: `/api/sets/${first}`,
      body: {
        sessionExercise: {
          sessionId,
          exerciseId: ids.bench.exercise,
          plannedExerciseId: bench,
          position: 0,
        },
        setNumber: 1,
        reps: 8,
        weight: 135,
        weightUnit: "LB",
        loggedAt: "2026-10-26T09:00:00.000Z",
      },
    });
    expect(log2?.request).toMatchObject({
      path: `/api/sets/${second}`,
      body: {
        sessionExercise: { id: se.id },
        setNumber: 2,
        loggedAt: "2026-10-26T09:03:00.000Z",
      },
    });
    expect(
      benchSets(h, sessionId).map((s) => [s.setNumber, s.reps, s.sync.state]),
    ).toEqual([
      [1, 8, "queued-no-signal"],
      [2, 7, "queued-no-signal"],
    ]);
  });

  it("resolves the unit override-first: KG for Front Squat, the LB default for Bench", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: frontSquat,
      reps: 5,
      weight: 100,
    });
    await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 5,
      weight: 185,
    });

    const bodies = h.layer.queue
      .getState()
      .items.filter((i) => i.op === "log")
      .map((i) => (i.request.body as { weightUnit: string }).weightUnit);
    expect(bodies).toEqual(["KG", "LB"]);
    const v = view(h, sessionId)!;
    expect(v.exercises.map((e) => e.unit)).toEqual(["LB", "KG"]);
    expect(v.exercises[1]!.sets[0]!.weightUnit).toBe("KG");
  });

  it("deletes a middle set and renumbers the survivors locally, as the server will", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    const setIds: string[] = [];
    for (const reps of [10, 9, 8, 7]) {
      setIds.push(
        await h.layer.sessions.logSet(sessionId, {
          plannedExerciseId: bench,
          reps,
          weight: 135,
        }),
      );
    }
    await h.layer.sessions.deleteSet(sessionId, setIds[1]!);

    expect(benchSets(h, sessionId).map((s) => [s.setNumber, s.reps])).toEqual([
      [1, 10],
      [2, 8],
      [3, 7],
    ]);
    const del = h.layer.queue.getState().items.at(-1)!;
    expect(del).toMatchObject({
      op: "delete",
      request: { method: "DELETE", path: `/api/sets/${setIds[1]}` },
      affects: [setIds[2], setIds[3]],
    });
    expect(del.request.body).toBeUndefined();
  });

  it("deleting an exercise's only set removes it, and the next set starts a new entry at 1", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    const only = await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 5,
      weight: 135,
    });
    const seBefore = view(h, sessionId)!.exercises[0]!.sessionExerciseId;
    await h.layer.sessions.deleteSet(sessionId, only);

    expect(view(h, sessionId)!.exercises[0]).toMatchObject({
      sessionExerciseId: null,
      sets: [],
    });
    expect(h.layer.sessions.get(sessionId)!.exercises).toEqual([]);

    await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 6,
      weight: 135,
    });
    const after = view(h, sessionId)!.exercises[0]!;
    expect(after.sessionExerciseId).not.toBe(seBefore);
    expect(after.sets.map((s) => s.setNumber)).toEqual([1]);
  });

  it("edits a set with absolute values and keeps its stamped unit", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    const setId = await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: frontSquat,
      reps: 5,
      weight: 100,
    });
    await h.layer.sessions.editSet(sessionId, setId, {
      reps: 4,
      weight: 102.5,
    });

    const edit = h.layer.queue.getState().items.at(-1)!;
    expect(edit.request).toEqual({
      method: "PATCH",
      path: `/api/sets/${setId}`,
      body: { reps: 4, weight: 102.5 },
    });
    expect(view(h, sessionId)!.exercises[1]!.sets[0]).toMatchObject({
      setNumber: 1,
      reps: 4,
      weight: 102.5,
      weightUnit: "KG",
      sync: { state: "queued-no-signal" },
    });
  });

  it("rejects an invalid set locally and queues nothing", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    await expect(
      h.layer.sessions.logSet(sessionId, {
        plannedExerciseId: bench,
        reps: -1,
        weight: 135,
      }),
    ).rejects.toThrow();
    expect(h.layer.queue.getState().items).toHaveLength(1);
    expect(h.layer.sessions.get(sessionId)!.exercises).toEqual([]);
  });

  it("delivers a backlog in order on reconnect, ending with sets 1 and 2 renumbered from 1 and 3", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    const setIds: string[] = [];
    for (const reps of [5, 4, 3]) {
      setIds.push(
        await h.layer.sessions.logSet(sessionId, {
          plannedExerciseId: bench,
          reps,
          weight: 225,
        }),
      );
    }
    await h.layer.sessions.deleteSet(sessionId, setIds[1]!);
    expect(h.server.applied).toEqual([]);

    h.connectivity.set(true);
    await h.layer.queue.settled();

    expect(h.server.applied.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PUT /api/sessions/${sessionId}`,
      `PUT /api/sets/${setIds[0]}`,
      `PUT /api/sets/${setIds[1]}`,
      `PUT /api/sets/${setIds[2]}`,
      `DELETE /api/sets/${setIds[1]}`,
    ]);
    expect(
      h.server.setsOf(bench).map((s) => [s.id, s.setNumber, s.reps]),
    ).toEqual([
      [setIds[0], 1, 5],
      [setIds[2], 2, 3],
    ]);
    expect(
      benchSets(h, sessionId).map((s) => [s.setNumber, s.reps, s.sync.state]),
    ).toEqual([
      [1, 5, "logged"],
      [2, 3, "logged"],
    ]);
  });

  it("shows failed, retrying through a 503, then logged once accepted", async () => {
    const h = await harness();
    await prefetch(h);
    let outage = true;
    h.server.failWith = (request) =>
      outage && request.path.startsWith("/api/sets/")
        ? new ApiError(503, request.path, null)
        : null;
    const sessionId = await h.layer.sessions.start(ids.workout);
    const setId = await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 5,
      weight: 225,
    });
    await h.layer.queue.settled();

    expect(benchSets(h, sessionId)[0]).toMatchObject({
      id: setId,
      sync: { state: "failed-retrying" },
    });
    expect(view(h, sessionId)!.sync.state).toBe("logged");

    outage = false;
    h.timers.fire();
    await h.layer.queue.settled();
    expect(benchSets(h, sessionId)[0]!.sync.state).toBe("logged");
  });

  it("marks a rejected set with the reason; later writes stay queued in order", async () => {
    const h = await harness();
    await prefetch(h);
    const sessionId = await h.layer.sessions.start(ids.workout);
    await h.layer.queue.settled();
    h.server.failWith = (request) =>
      request.method === "PUT" && request.path.startsWith("/api/sets/")
        ? new ApiError(400, request.path, "Weight is out of range.")
        : null;
    const rejected = await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 5,
      weight: 225,
    });
    const later = await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 5,
      weight: 225,
    });
    await h.layer.queue.settled();

    const sets = benchSets(h, sessionId);
    expect(sets.find((s) => s.id === rejected)!.sync).toEqual({
      state: "rejected",
      reason: "Weight is out of range.",
    });
    expect(sets.find((s) => s.id === later)!.sync.state).toBe(
      "queued-in-order",
    );
  });

  it("keeps a finished session until every write is acknowledged, then drops it", async () => {
    const h = await harness();
    const sessionId = await offlineSession(h);
    await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 5,
      weight: 225,
    });
    await h.layer.sessions.finish(sessionId);
    await h.layer.sessions.finish(sessionId); // a double tap queues nothing more

    expect(h.layer.sessions.get(sessionId)!.status).toBe("FINISHED");
    expect(h.layer.queue.getState().items.map((i) => i.op)).toEqual([
      "start",
      "log",
      "finish",
    ]);
    await expect(
      h.layer.sessions.logSet(sessionId, {
        plannedExerciseId: bench,
        reps: 5,
        weight: 225,
      }),
    ).rejects.toBeInstanceOf(LocalSessionError);

    const acked: string[] = [];
    h.layer.onAck((item) => acked.push(item.op));
    h.connectivity.set(true);
    await h.layer.queue.settled();
    expect(acked).toEqual(["start", "log", "finish"]);
    expect(h.server.sessions.get(sessionId)?.status).toBe("COMPLETED");
    expect(h.layer.sessions.get(sessionId)).toBeUndefined();
  });

  it("survives a restart before sync: three queued sets are still shown, still queued", async () => {
    const first = await harness();
    const sessionId = await offlineSession(first);
    for (const reps of [5, 5, 4]) {
      await first.layer.sessions.logSet(sessionId, {
        plannedExerciseId: bench,
        reps,
        weight: 225,
      });
    }
    first.layer.close();
    harnesses = harnesses.filter((h) => h !== first);

    // Reopened with airplane mode still on.
    const connectivity = new FakeConnectivity();
    connectivity.online = false;
    const reopened = await harness({ dbName: first.dbName, connectivity });
    await reopened.layer.queue.settled();
    expect(reopened.server.applied).toEqual([]);
    expect(
      benchSets(reopened, sessionId).map((s) => [s.setNumber, s.sync.state]),
    ).toEqual([
      [1, "queued-no-signal"],
      [2, "queued-no-signal"],
      [3, "queued-no-signal"],
    ]);
  });
});

describe("adopting a session started on another device", () => {
  /** What `GET /sessions/:id` returns for the fake server's state. */
  function detailFrom(h: Harness, sessionId: string): SessionDetailResponse {
    const context = contextFor();
    return {
      session: {
        id: sessionId,
        workoutId: ids.workout,
        workoutName: "Push A",
        programName: "Push Pull Legs",
        cycleNumber: 1,
        performedAt: "2026-10-26T08:00:00.000Z",
        status: "IN_PROGRESS",
      },
      exercises: context.exercises
        .filter(
          (e): e is typeof e & { exerciseId: string; name: string } =>
            e.exerciseId !== null && e.name !== null,
        )
        .map((e) => {
          const se = [...h.server.sessionExercises].find(
            ([, v]) => v.plannedExerciseId === e.plannedExerciseId,
          );
          return {
            position: e.position,
            sessionExerciseId: se?.[0] ?? null,
            exerciseId: e.exerciseId,
            name: e.name,
            plannedExerciseId: e.plannedExerciseId,
            skipped: !se,
            sets: h.server.setsOf(e.plannedExerciseId).map((s) => ({
              id: s.id,
              setNumber: s.setNumber,
              reps: s.reps,
              weight: s.weight,
              weightUnit: s.weightUnit as "LB" | "KG",
              kind: "NORMAL" as const,
            })),
          };
        }),
    };
  }

  it("continues under the existing session exercise: the next set is 3, not a second row at 1", async () => {
    // A phone starts the workout and logs two sets, all delivered.
    const phone = await harness();
    await prefetch(phone);
    const sessionId = await phone.layer.sessions.start(ids.workout);
    for (const reps of [5, 5]) {
      await phone.layer.sessions.logSet(sessionId, {
        plannedExerciseId: bench,
        reps,
        weight: 225,
      });
    }
    await phone.layer.queue.settled();
    expect(phone.server.setsOf(bench)).toHaveLength(2);

    // A laptop that never saw it adopts it from the server, then logs on.
    const laptop = await harness({ server: phone.server });
    await laptop.layer.sessions.adopt(
      detailFrom(phone, sessionId),
      contextFor(),
    );
    expect(laptop.layer.queue.getState().items).toEqual([]);
    expect(
      benchSets(laptop, sessionId).map((s) => [s.setNumber, s.sync.state]),
    ).toEqual([
      [1, "logged"],
      [2, "logged"],
    ]);
    expect(view(laptop, sessionId)!.exercises[1]!.sessionExerciseId).toBe(null);

    await laptop.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 4,
      weight: 225,
    });
    await laptop.layer.queue.settled();

    expect(laptop.server.sessionExercises.size).toBe(1);
    expect(
      laptop.server.setsOf(bench).map((s) => [s.setNumber, s.reps]),
    ).toEqual([
      [1, 5],
      [2, 5],
      [3, 4],
    ]);
  });

  it("deletes an adopted set and renumbers like the server", async () => {
    const phone = await harness();
    await prefetch(phone);
    const sessionId = await phone.layer.sessions.start(ids.workout);
    for (const reps of [5, 6, 7]) {
      await phone.layer.sessions.logSet(sessionId, {
        plannedExerciseId: bench,
        reps,
        weight: 225,
      });
    }
    await phone.layer.queue.settled();

    const laptop = await harness({ server: phone.server });
    await laptop.layer.sessions.adopt(
      detailFrom(phone, sessionId),
      contextFor(),
    );
    const second = benchSets(laptop, sessionId)[1]!;
    await laptop.layer.sessions.deleteSet(sessionId, second.id);
    await laptop.layer.queue.settled();

    expect(
      laptop.server.setsOf(bench).map((s) => [s.setNumber, s.reps]),
    ).toEqual([
      [1, 5],
      [2, 7],
    ]);
    expect(
      benchSets(laptop, sessionId).map((s) => [s.setNumber, s.reps]),
    ).toEqual([
      [1, 5],
      [2, 7],
    ]);
  });
});

describe("prefetch", () => {
  it("stores what's next and each listed workout's context; one failure doesn't stop the rest", async () => {
    const h = await harness();
    h.api.nextResponse = {
      next: [
        {
          programId: ids.program,
          programName: "PPL",
          workoutId: ids.workout,
          workoutName: "Push A",
          cycleNumber: 1,
        },
        {
          programId: ids.program,
          programName: "UL",
          workoutId: ids.workout2,
          workoutName: "Legs A",
          cycleNumber: 1,
        },
      ],
      inProgress: [],
    };
    h.api.failContext.add(ids.workout2);
    const { prefetched } = await h.layer.loadNext();
    await expect(prefetched).resolves.toEqual({
      stored: [ids.workout],
      failed: [ids.workout2],
    });

    expect((await h.layer.contexts.get(ids.workout))?.context).toEqual(
      contextFor(ids.workout),
    );
    expect(await h.layer.contexts.get(ids.workout2)).toBeUndefined();
    expect((await h.layer.contexts.readNext(h.layer.userId()!))?.next).toEqual(
      h.api.nextResponse,
    );
  });

  it("forgets the previous account's cached plan when another account signs in", async () => {
    const h = await harness();
    await prefetch(h);
    await h.layer.signedIn({ userId: "someone_else", email: null });
    expect(await h.layer.contexts.get(ids.workout)).toBeUndefined();
    expect(await h.layer.contexts.readNext("someone_else")).toBeNull();
  });
});

describe("finished records left behind", () => {
  it("drops a FINISHED record with nothing queued on load (the ack follow-up never ran)", async () => {
    const first = await harness();
    const sessionId = await offlineSession(first);
    await first.layer.sessions.finish(sessionId);
    // Every write was acked, but the app stopped before the record was dropped.
    await first.layer.db.clear("queue");
    first.layer.close();
    harnesses = harnesses.filter((h) => h !== first);

    const reopened = await harness({ dbName: first.dbName });
    expect(reopened.layer.sessions.get(sessionId)).toBeUndefined();
    expect(await reopened.layer.db.get("sessions", sessionId)).toBeUndefined();
  });

  it("keeps a FINISHED record whose writes are still queued", async () => {
    const first = await harness();
    const sessionId = await offlineSession(first);
    await first.layer.sessions.finish(sessionId);
    first.layer.close();
    harnesses = harnesses.filter((h) => h !== first);

    const connectivity = new FakeConnectivity();
    connectivity.online = false;
    const reopened = await harness({ dbName: first.dbName, connectivity });
    expect(reopened.layer.sessions.get(sessionId)?.status).toBe("FINISHED");
  });
});

describe("who owns a write", () => {
  it("stamps Clerk's signed-in user before the last-user record exists", async () => {
    const h = await harness({
      signIn: false,
      currentUserId: () => "user_live",
    });
    expect(h.layer.lastUser.getSnapshot()).toBeNull();
    const sessionId = await offlineSession(h);
    await h.layer.sessions.logSet(sessionId, {
      plannedExerciseId: bench,
      reps: 5,
      weight: 135,
    });

    expect(h.layer.sessions.get(sessionId)?.userId).toBe("user_live");
    expect(h.layer.queue.getState().items.map((i) => i.userId)).toEqual([
      "user_live",
      "user_live",
    ]);
    // So another account signing in holds them rather than sending them.
    expect((await h.layer.contexts.readNext("user_live"))?.next).toEqual(
      h.api.nextResponse,
    );
  });

  it("refuses to start a workout when no user is known at all", async () => {
    const h = await harness({ signIn: false, currentUserId: () => undefined });
    await expect(h.layer.sessions.start(ids.workout)).rejects.toMatchObject({
      code: "not-signed-in",
    });
    expect(h.layer.queue.getState().items).toEqual([]);
    expect(h.layer.sessions.getSnapshot().size).toBe(0);
  });

  it("stores and prefetches what's next once Clerk reports a user", async () => {
    const clerk: { userId?: string } = {};
    const auth = new FakeAuth();
    const h = await harness({
      signIn: false,
      currentUserId: () => clerk.userId,
      auth,
    });
    await (
      await h.layer.loadNext()
    ).prefetched;
    expect(await h.layer.contexts.get(ids.workout)).toBeUndefined();

    clerk.userId = "user_live";
    auth.notify();
    await h.layer.prefetchSettled();
    expect((await h.layer.contexts.get(ids.workout))?.userId).toBe("user_live");
    expect(await h.layer.contexts.readNext("user_live")).not.toBeNull();
  });

  it("stores and prefetches what's next once the user is recorded", async () => {
    const h = await harness({ signIn: false, currentUserId: () => undefined });
    await (
      await h.layer.loadNext()
    ).prefetched;
    expect(await h.layer.contexts.get(ids.workout)).toBeUndefined();

    await h.layer.signedIn({ userId: "user_recorded", email: null });
    await h.layer.prefetchSettled();
    expect((await h.layer.contexts.get(ids.workout))?.userId).toBe(
      "user_recorded",
    );
  });
});

describe("skipping a whole workout (design D15 of step-4a)", () => {
  it("skips offline from the prefetched plan: one SKIPPED record, one queued skip, nothing else", async () => {
    const h = await harness();
    await prefetch(h);
    h.connectivity.set(false);

    const sessionId = await h.layer.sessions.skip(ids.workout);

    expect(uuidV7.safeParse(sessionId).success).toBe(true);
    expect(h.layer.sessions.get(sessionId)).toMatchObject({
      workoutId: ids.workout,
      status: "SKIPPED",
      exercises: [],
      performedAt: "2026-10-26T09:00:00.000Z",
    });
    const items = h.layer.queue.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      op: "skip",
      sessionId,
      request: {
        method: "POST",
        path: `/api/workouts/${ids.workout}/skip`,
        body: { sessionId, performedAt: "2026-10-26T09:00:00.000Z" },
      },
    });

    // A second tap returns the same skip and queues nothing more; the
    // skipped workout takes no sets and can't be finished.
    expect(await h.layer.sessions.skip(ids.workout)).toBe(sessionId);
    await h.layer.sessions.finish(sessionId);
    await expect(
      h.layer.sessions.logSet(sessionId, {
        plannedExerciseId: bench,
        reps: 5,
        weight: 225,
      }),
    ).rejects.toBeInstanceOf(LocalSessionError);
    expect(h.layer.queue.getState().items).toHaveLength(1);
  });

  it("a double tap that overlaps is still one skip: one record, one queued write", async () => {
    const h = await harness();
    await prefetch(h);
    h.connectivity.set(false);

    const [a, b] = await Promise.all([
      h.layer.sessions.skip(ids.workout),
      h.layer.sessions.skip(ids.workout),
    ]);

    expect(b).toBe(a);
    expect(h.layer.queue.getState().items.map((i) => i.op)).toEqual(["skip"]);
    expect(
      [...h.layer.sessions.getSnapshot().values()].filter(
        (r) => r.workoutId === ids.workout,
      ),
    ).toHaveLength(1);
  });

  it("two overlapping starts of one workout open one session with one queued start", async () => {
    const h = await harness();
    await prefetch(h);
    h.connectivity.set(false);

    const [a, b] = await Promise.all([
      h.layer.sessions.start(ids.workout),
      h.layer.sessions.start(ids.workout),
    ]);

    expect(b).toBe(a);
    expect(h.layer.queue.getState().items.map((i) => i.op)).toEqual(["start"]);
  });

  it("an overlapping start and skip of one workout: the start wins, the skip is refused", async () => {
    const h = await harness();
    await prefetch(h);
    h.connectivity.set(false);

    const [started, skipped] = await Promise.allSettled([
      h.layer.sessions.start(ids.workout),
      h.layer.sessions.skip(ids.workout),
    ]);

    expect(started.status).toBe("fulfilled");
    expect(skipped.status).toBe("rejected");
    expect(h.layer.queue.getState().items.map((i) => i.op)).toEqual(["start"]);
  });

  it("serializes per workout only: different workouts still start side by side", async () => {
    const h = await harness();
    await prefetch(h);
    await h.layer.contexts.prefetchWorkouts(USER, [ids.workout2]);
    h.connectivity.set(false);

    const [push, legs] = await Promise.all([
      h.layer.sessions.start(ids.workout),
      h.layer.sessions.skip(ids.workout2),
    ]);

    expect(push).not.toBe(legs);
    expect(
      h.layer.queue
        .getState()
        .items.map((i) => i.op)
        .sort(),
    ).toEqual(["skip", "start"]);
  });

  it("never skips a workout already started here, naming it", async () => {
    const h = await harness();
    await offlineSession(h);

    await expect(h.layer.sessions.skip(ids.workout)).rejects.toThrow(
      "Push A is already started, so it can't be skipped. Finish it instead.",
    );
    expect(h.layer.queue.getState().items.map((i) => i.op)).toEqual(["start"]);
  });

  it("survives a reload, then reaches the server in order on reconnect and is dropped", async () => {
    const first = await makeHarness();
    await prefetch(first);
    first.connectivity.set(false);
    const push = await first.layer.sessions.skip(ids.workout);
    const legs = await first.layer.sessions.skip(ids.workout2);
    first.layer.close();

    const offline = new FakeConnectivity();
    offline.online = false;
    const h = await harness({ dbName: first.dbName, connectivity: offline });
    expect(h.layer.sessions.get(push)?.status).toBe("SKIPPED");
    expect(h.server.applied).toEqual([]);

    h.connectivity.set(true);
    await h.layer.queue.settled();
    expect(h.server.applied.map((r) => r.path)).toEqual([
      `/api/workouts/${ids.workout}/skip`,
      `/api/workouts/${ids.workout2}/skip`,
    ]);
    expect(h.server.sessions.get(push)).toEqual({
      workoutId: ids.workout,
      status: "SKIPPED",
    });
    expect(h.server.sessions.get(legs)?.status).toBe("SKIPPED");
    // Delivered: the records go, and the workouts stay resolved until a
    // fresher server read arrives.
    expect(h.layer.sessions.get(push)).toBeUndefined();
    expect([...h.layer.sessions.settledWorkouts().keys()].sort()).toEqual(
      [ids.workout, ids.workout2].sort(),
    );
  });

  it("can't skip offline a workout that was never prefetched", async () => {
    const h = await harness();
    h.connectivity.set(false);
    h.api.failContext.add(ids.workout);
    await expect(h.layer.sessions.skip(ids.workout)).rejects.toMatchObject({
      code: "no-context",
    });
    expect(h.layer.queue.getState().items).toEqual([]);
  });
});
