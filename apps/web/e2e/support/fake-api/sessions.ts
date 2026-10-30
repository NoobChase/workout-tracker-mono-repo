import {
  editSetRequest,
  historyPageResponse,
  logSetRequest,
  sessionDetailResponse,
  skippedSession,
  skipWorkoutRequest,
  startWorkoutRequest,
  whatsNextResponse,
  workoutContextResponse,
} from "@workout-tracker/shared";
import { fail, ok, type Answer } from "./fixtures.js";
import type { FakeTables } from "./programs.js";

/*
 * The training side of the fake API (operations.md 4): what's next, a
 * workout's context, starting, logging, editing and deleting sets, finishing
 * and skipping, history and one session's detail. Client ids are
 * idempotency keys; a delete renumbers the survivors and drops an emptied
 * session exercise; a finish or skip that resolves an ACTIVE program's last
 * workout rolls it over or completes it (`FakeTables.advance`).
 */

/** The set-write knobs a spec turns (`FakeApi`). */
export interface SetRefusals {
  /** Return a reason to reject a set write; the queue stops there. */
  rejectSet: ((body: unknown) => string | null) | null;
  /** The status a rejected set write gets: 422 invalid, 403 not entitled. */
  rejectStatus: number;
}

/** The training routes, or null if not one. */
export function sessionRoutes(
  t: FakeTables,
  refusals: SetRefusals,
  method: string,
  url: URL,
  parts: string[],
  body: unknown,
): Answer | null {
  const path = url.pathname;
  const [, , resource, id, action] = parts;
  if (method === "GET" && path === "/api/next") return ok(next(t));
  if (method === "GET" && path === "/api/history") {
    return ok(history(t, url.searchParams.get("cursor")));
  }
  if (method === "GET" && resource === "workouts" && action === "context") {
    const found = context(t, id!);
    return found ? ok(found) : fail(404, "No such workout.");
  }
  if (method === "POST" && resource === "workouts" && action === "skip") {
    return skip(t, id!, body);
  }
  if (resource === "sessions" && id) {
    if (method === "PUT") return start(t, id, body);
    if (method === "POST" && action === "finish") {
      if (!t.sessions.has(id)) return fail(404, "No such session.");
      const extended = t.finish(id);
      return ok({ sessionId: id, status: "COMPLETED", extended });
    }
    if (method === "GET") {
      const found = detail(t, id);
      return found ? ok(found) : fail(404, "No such session.");
    }
  }
  if (resource === "sets" && id) {
    if (method === "PUT") return logSet(t, refusals, id, body);
    if (method === "PATCH") {
      const req = editSetRequest.parse(body);
      const set = t.sets.get(id);
      if (!set) return fail(404, "That set doesn't exist.");
      set.reps = req.reps;
      set.weight = req.weight;
      return ok({ ...set, kind: "NORMAL", loggedAt: new Date().toISOString() });
    }
    if (method === "DELETE") {
      deleteSet(t, id);
      return { status: 204, data: undefined };
    }
  }
  return null;
}

function start(t: FakeTables, id: string, body: unknown): Answer {
  const req = startWorkoutRequest.parse(body);
  if (!t.sessions.has(id)) {
    t.sessions.set(id, {
      id,
      workoutId: req.workoutId,
      performedAt: req.performedAt,
      status: "IN_PROGRESS",
    });
  }
  const s = t.sessions.get(id)!;
  return ok(
    {
      id,
      workoutId: s.workoutId,
      status: s.status,
      performedAt: s.performedAt,
    },
    201,
  );
}

function logSet(
  t: FakeTables,
  refusals: SetRefusals,
  id: string,
  body: unknown,
): Answer {
  const req = logSetRequest.parse(body);
  const reason = refusals.rejectSet?.(req) ?? null;
  if (reason) return fail(refusals.rejectStatus, reason);
  if (!t.sessions.has(req.sessionExercise.sessionId)) {
    return fail(404, "That workout session doesn't exist.");
  }
  if (!t.sessionExercises.has(req.sessionExercise.id)) {
    t.sessionExercises.set(req.sessionExercise.id, { ...req.sessionExercise });
  }
  if (!t.sets.has(id)) {
    t.sets.set(id, {
      id,
      sessionExerciseId: req.sessionExercise.id,
      setNumber: req.setNumber,
      reps: req.reps,
      weight: req.weight,
      weightUnit: req.weightUnit ?? t.unit(req.sessionExercise.exerciseId),
    });
  }
  return ok({ ...t.sets.get(id), kind: "NORMAL", loggedAt: req.loggedAt }, 201);
}

function deleteSet(t: FakeTables, id: string): void {
  const set = t.sets.get(id);
  if (!set) return;
  t.sets.delete(id);
  const survivors = [...t.sets.values()]
    .filter((s) => s.sessionExerciseId === set.sessionExerciseId)
    .sort((a, b) => a.setNumber - b.setNumber);
  survivors.forEach((s, i) => (s.setNumber = i + 1));
  if (survivors.length === 0) t.sessionExercises.delete(set.sessionExerciseId);
}

/** `skipWorkout` (operations.md 4.14). */
function skip(t: FakeTables, workoutId: string, body: unknown): Answer {
  const req = skipWorkoutRequest.parse(body);
  const workout = t.workouts.find((w) => w.id === workoutId);
  if (!workout) return fail(404, "That workout doesn't exist.");
  const stored = t.sessions.get(req.sessionId);
  if (!stored) {
    const other = [...t.sessions.values()].find(
      (s) => s.workoutId === workoutId,
    );
    if (other) {
      const why =
        other.status === "IN_PROGRESS"
          ? "is already started, so it can't be skipped. Finish it instead."
          : other.status === "COMPLETED"
            ? "is already done, so it can't be skipped."
            : "is already skipped.";
      return fail(409, `${workout.name} ${why}`);
    }
    t.sessions.set(req.sessionId, {
      id: req.sessionId,
      workoutId,
      performedAt: req.performedAt,
      status: "SKIPPED",
    });
    t.advance(workout.programId);
  } else if (stored.workoutId !== workoutId || stored.status !== "SKIPPED") {
    return fail(409, "That session id is already in use.");
  }
  const s = t.sessions.get(req.sessionId)!;
  return ok(
    skippedSession.parse({
      id: s.id,
      workoutId: s.workoutId,
      status: "SKIPPED",
      performedAt: s.performedAt,
    }),
  );
}

function next(t: FakeTables) {
  const items = t.programs
    .filter((p) => p.status === "ACTIVE")
    .flatMap((program) => {
      const w = t.workoutsOf(program.id).find((x) => !t.resolved(x.id));
      return w
        ? [
            {
              programId: program.id,
              programName: program.name,
              workoutId: w.id,
              workoutName: w.name,
              cycleNumber: w.cycleNumber,
            },
          ]
        : [];
    });
  const inProgress = [...t.sessions.values()]
    .filter((s) => s.status === "IN_PROGRESS")
    .map((s) => {
      const w = t.workouts.find((x) => x.id === s.workoutId)!;
      return {
        sessionId: s.id,
        workoutId: w.id,
        workoutName: w.name,
        programName: t.programs.find((p) => p.id === w.programId)!.name,
        performedAt: s.performedAt,
      };
    });
  return whatsNextResponse.parse({ next: items, inProgress });
}

/** The newest completed session's sets of `exerciseId`, as last time. */
function lastTime(t: FakeTables, exerciseId: string) {
  const completed = [...t.sessions.values()]
    .filter((s) => s.status === "COMPLETED")
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  for (const s of completed) {
    const se = [...t.sessionExercises.values()].find(
      (x) => x.sessionId === s.id && x.exerciseId === exerciseId,
    );
    const sets = se
      ? [...t.sets.values()]
          .filter((x) => x.sessionExerciseId === se.id)
          .sort((a, b) => a.setNumber - b.setNumber)
      : [];
    if (sets.length > 0) {
      return {
        sessionId: s.id,
        performedAt: s.performedAt,
        sets: sets.map((x) => ({
          setNumber: x.setNumber,
          reps: x.reps,
          weight: x.weight,
          weightUnit: x.weightUnit,
        })),
      };
    }
  }
  return null;
}

function context(t: FakeTables, workoutId: string) {
  const w = t.workouts.find((x) => x.id === workoutId);
  if (!w) return null;
  const program = t.programs.find((p) => p.id === w.programId)!;
  return workoutContextResponse.parse({
    workout: {
      id: w.id,
      name: w.name,
      position: w.position,
      cycleNumber: w.cycleNumber,
      programId: program.id,
      programName: program.name,
    },
    units: t.units,
    exercises: w.exercises.map((e) => {
      if (e.exerciseId === null) {
        return {
          plannedExerciseId: e.plannedExerciseId,
          position: e.position,
          exerciseId: null,
          name: null,
          placeholderLabel: e.placeholderLabel,
          metrics: [],
          targetSets: e.targetSets,
          plannedSets: [],
          lastTime: null,
        };
      }
      const exercise = t.exercises.get(e.exerciseId)!;
      return {
        plannedExerciseId: e.plannedExerciseId,
        position: e.position,
        exerciseId: e.exerciseId,
        name: exercise.name,
        placeholderLabel: null,
        metrics: exercise.metrics.map((m) => m.metric),
        targetSets: e.targetSets,
        plannedSets: [...e.plannedSets]
          .sort((a, b) => a.setNumber - b.setNumber)
          .map((x) => ({
            setNumber: x.setNumber,
            repsMin: x.targetRepsMin,
            repsMax: x.targetRepsMax,
            weight: x.targetWeight,
            weightUnit: x.weightUnit,
            targetRpe: x.targetRpe,
            targetRir: x.targetRir,
          })),
        lastTime: lastTime(t, e.exerciseId),
      };
    }),
  });
}

function detail(t: FakeTables, sessionId: string) {
  const s = t.sessions.get(sessionId);
  if (!s) return null;
  const w = t.workouts.find((x) => x.id === s.workoutId)!;
  return sessionDetailResponse.parse({
    session: {
      id: s.id,
      workoutId: w.id,
      workoutName: w.name,
      programName: t.programs.find((p) => p.id === w.programId)!.name,
      cycleNumber: w.cycleNumber,
      performedAt: s.performedAt,
      status: s.status,
    },
    exercises: w.exercises.flatMap((e) => {
      if (e.exerciseId === null) return [];
      const se = [...t.sessionExercises.values()].find(
        (x) =>
          x.sessionId === s.id && x.plannedExerciseId === e.plannedExerciseId,
      );
      return {
        position: e.position,
        sessionExerciseId: se?.id ?? null,
        exerciseId: e.exerciseId,
        name: t.name(e.exerciseId),
        plannedExerciseId: e.plannedExerciseId,
        skipped: !se,
        sets: se
          ? [...t.sets.values()]
              .filter((x) => x.sessionExerciseId === se.id)
              .sort((a, b) => a.setNumber - b.setNumber)
              .map((x) => ({
                id: x.id,
                setNumber: x.setNumber,
                reps: x.reps,
                weight: x.weight,
                weightUnit: x.weightUnit,
                kind: "NORMAL",
              }))
          : [],
      };
    }),
  });
}

function history(t: FakeTables, cursor: string | null) {
  const done = [...t.sessions.values()]
    .filter((s) => s.status === "COMPLETED")
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  const start = cursor ? Number(cursor) : 0;
  const page = done.slice(start, start + t.historyPageSize);
  const end = start + page.length;
  return historyPageResponse.parse({
    items: page.map((s) => {
      const w = t.workouts.find((x) => x.id === s.workoutId)!;
      const ses = new Set(
        [...t.sessionExercises.values()]
          .filter((x) => x.sessionId === s.id)
          .map((x) => x.id),
      );
      return {
        sessionId: s.id,
        performedAt: s.performedAt,
        programName: t.programs.find((p) => p.id === w.programId)!.name,
        workoutName: w.name,
        cycleNumber: w.cycleNumber,
        countedSets: [...t.sets.values()].filter((x) =>
          ses.has(x.sessionExerciseId),
        ).length,
      };
    }),
    nextCursor: end < done.length ? String(end) : null,
  });
}
