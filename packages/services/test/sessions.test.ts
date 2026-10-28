// specs/workout-sessions: start, log, edit, delete, skip and resume, each
// write replayed with the same ids, against a real Neon branch.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sessionDetailResponse } from "@workout-tracker/shared";
import {
  deleteSet,
  editSet,
  getSession,
  logSet,
  startWorkout,
  whatsNext,
} from "../src/index";
import {
  Training,
  cleanup,
  db,
  newId,
  newUser,
  pool,
  rejectsWith,
  rowCount,
  startTemplate,
} from "./db";

after(cleanup);

async function sessionRows(sessionId: string) {
  const sessions = await rowCount(
    "SELECT 1 FROM workout_sessions WHERE id = $1",
    [sessionId],
  );
  const exercises = await rowCount(
    "SELECT 1 FROM session_exercises WHERE session_id = $1",
    [sessionId],
  );
  const sets = await rowCount(
    `SELECT 1 FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id
      WHERE se.session_id = $1`,
    [sessionId],
  );
  return { sessions, exercises, sets };
}

async function setsOf(sessionExerciseId: string) {
  const { rows } = await pool.query<{
    id: string;
    set_number: number;
    reps: number;
    weight: string;
    weight_unit: string;
    xmin: string;
  }>(
    `SELECT id, set_number, reps, weight, weight_unit, xmin::text
       FROM session_sets WHERE session_exercise_id = $1 ORDER BY set_number`,
    [sessionExerciseId],
  );
  return rows;
}

describe("startWorkout", () => {
  it("writes exactly one IN_PROGRESS session and nothing beneath it", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const sessionId = newId();
    const performedAt = "2026-10-20T14:03:00.000Z";

    const started = await startWorkout(db, user, sessionId, {
      workoutId: workouts[0]!.id,
      performedAt,
    });

    assert.deepEqual(started, {
      id: sessionId,
      workoutId: workouts[0]!.id,
      status: "IN_PROGRESS",
      performedAt,
    });
    assert.deepEqual(await sessionRows(sessionId), {
      sessions: 1,
      exercises: 0,
      sets: 0,
    });
  });

  it("replays as a no-op with the same answer", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const sessionId = newId();
    const input = {
      workoutId: workouts[0]!.id,
      performedAt: new Date().toISOString(),
    };
    const first = await startWorkout(db, user, sessionId, input);
    const { rows: x1 } = await pool.query(
      "SELECT xmin::text FROM workout_sessions WHERE id = $1",
      [sessionId],
    );
    const second = await startWorkout(db, user, sessionId, input);
    const { rows: x2 } = await pool.query(
      "SELECT xmin::text FROM workout_sessions WHERE id = $1",
      [sessionId],
    );
    assert.deepEqual(second, first);
    assert.deepEqual(x2, x1);
    assert.equal(
      await rowCount("SELECT 1 FROM workout_sessions WHERE user_id = $1", [
        user,
      ]),
      1,
    );
  });

  it("refuses someone else's workout and writes nothing", async () => {
    const owner = await newUser();
    const { workouts } = await startTemplate(owner);
    const intruder = await newUser();
    const sessionId = newId();
    await rejectsWith(
      startWorkout(db, intruder, sessionId, {
        workoutId: workouts[0]!.id,
        performedAt: new Date().toISOString(),
      }),
      "not_found",
    );
    assert.deepEqual(await sessionRows(sessionId), {
      sessions: 0,
      exercises: 0,
      sets: 0,
    });
  });

  it("refuses a session id that is already another user's", async () => {
    const owner = await newUser();
    const a = await startTemplate(owner);
    const t = await Training.start(owner, a.workouts[0]!);
    const intruder = await newUser();
    const b = await startTemplate(intruder);
    await rejectsWith(
      startWorkout(db, intruder, t.sessionId, {
        workoutId: b.workouts[0]!.id,
        performedAt: new Date().toISOString(),
      }),
      "conflict",
    );
    assert.equal(
      await rowCount("SELECT 1 FROM workout_sessions WHERE user_id = $1", [
        intruder,
      ]),
      0,
    );
  });
});

describe("logSet", () => {
  it("creates the session exercise and set 1 on first contact", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);

    const set = await t.log(0, 1, 8, 135);

    assert.equal(set.setNumber, 1);
    assert.equal(set.reps, 8);
    assert.equal(set.weight, 135);
    assert.equal(set.weightUnit, "LB");
    assert.equal(set.kind, "NORMAL");
    assert.equal(set.loggedAt, set.request.loggedAt);
    const { rows } = await pool.query(
      "SELECT exercise_id, planned_exercise_id, position FROM session_exercises WHERE session_id = $1",
      [t.sessionId],
    );
    assert.deepEqual(rows, [
      {
        exercise_id: workouts[0]!.exercises[0]!.exerciseId,
        planned_exercise_id: workouts[0]!.exercises[0]!.id,
        position: 0,
      },
    ]);
    assert.deepEqual(await sessionRows(t.sessionId), {
      sessions: 1,
      exercises: 1,
      sets: 1,
    });
  });

  it("replays as a no-op: one row, the same answer", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const setId = newId();
    const request = t.request(0, 1, 8, 135);

    const first = await logSet(db, user, setId, request);
    const [before] = await setsOf(request.sessionExercise.id);
    const second = await logSet(db, user, setId, request);
    const after = await setsOf(request.sessionExercise.id);

    assert.deepEqual(second, first);
    assert.equal(after.length, 1);
    assert.equal(after[0]!.xmin, before!.xmin);
    assert.deepEqual(await sessionRows(t.sessionId), {
      sessions: 1,
      exercises: 1,
      sets: 1,
    });
  });

  it("replays after the set was edited without undoing the edit", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const setId = newId();
    const request = t.request(0, 1, 8, 135);
    await logSet(db, user, setId, request);
    await editSet(db, user, setId, { reps: 6, weight: 135 });

    const replay = await logSet(db, user, setId, request);
    assert.equal(replay.reps, 6);
  });

  it("numbers later sets in order, and a set beyond the target is just recorded", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const target = workouts[0]!.exercises[0]!.targetSets;
    for (let n = 1; n <= target + 1; n++) await t.log(0, n, 5, 185);

    const rows = await setsOf(
      t.sessionExerciseIds.get(workouts[0]!.exercises[0]!.id)!,
    );
    assert.deepEqual(
      rows.map((r) => r.set_number),
      Array.from({ length: target + 1 }, (_, i) => i + 1),
    );
  });

  it("records exactly the sets logged when stopping short", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    await t.log(0, 1, 5, 185);
    await t.log(0, 2, 5, 185);
    await t.finish();
    assert.equal((await sessionRows(t.sessionId)).sets, 2);
  });

  it("falls back to the exercise override, then the user's default, when no unit is sent", async () => {
    const user = await newUser("KG");
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const overridden = workouts[0]!.exercises[1]!.exerciseId;
    await pool.query(
      `INSERT INTO user_exercise_settings (id, user_id, exercise_id, default_weight_unit)
       VALUES ($1, $2, $3, 'LB')`,
      [newId(), user, overridden],
    );

    const plain = await t.log(0, 1, 5, 100, null);
    const override = await t.log(1, 1, 5, 100, null);
    const explicit = await t.log(2, 1, 5, 100, "LB");

    assert.equal(plain.weightUnit, "KG");
    assert.equal(override.weightUnit, "LB");
    assert.equal(explicit.weightUnit, "LB");
  });

  it("refuses a set into a finished session", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    await t.finish();
    await rejectsWith(
      logSet(db, user, newId(), t.request(0, 1, 5, 100)),
      "invalid",
    );
    assert.equal((await sessionRows(t.sessionId)).exercises, 0);
  });

  it("refuses logging into another user's session, writing nothing", async () => {
    const owner = await newUser();
    const a = await startTemplate(owner);
    const victim = await Training.start(owner, a.workouts[0]!);
    const intruder = await newUser();

    const request = victim.request(0, 1, 5, 100);
    await rejectsWith(logSet(db, intruder, newId(), request), "not_found");
    assert.deepEqual(await sessionRows(victim.sessionId), {
      sessions: 1,
      exercises: 0,
      sets: 0,
    });
  });

  it("refuses a session exercise id that is another user's, writing nothing", async () => {
    const owner = await newUser();
    const a = await startTemplate(owner);
    const victim = await Training.start(owner, a.workouts[0]!);
    const theirs = await victim.log(0, 1, 5, 100);

    const intruder = await newUser();
    const b = await startTemplate(intruder);
    const mine = await Training.start(intruder, b.workouts[0]!);
    const request = mine.request(0, 1, 5, 100);
    request.sessionExercise.id = theirs.sessionExerciseId;

    await rejectsWith(logSet(db, intruder, newId(), request), "conflict");
    assert.deepEqual(await sessionRows(mine.sessionId), {
      sessions: 1,
      exercises: 0,
      sets: 0,
    });
    assert.equal((await sessionRows(victim.sessionId)).sets, 1);
  });

  it("refuses a set id that is another user's set", async () => {
    const owner = await newUser();
    const a = await startTemplate(owner);
    const victim = await Training.start(owner, a.workouts[0]!);
    const theirs = await victim.log(0, 1, 5, 100);

    const intruder = await newUser();
    const b = await startTemplate(intruder);
    const mine = await Training.start(intruder, b.workouts[0]!);
    await rejectsWith(
      logSet(db, intruder, theirs.id, mine.request(0, 1, 5, 100)),
      "conflict",
    );
    assert.equal((await sessionRows(mine.sessionId)).exercises, 0);
  });

  it("refuses a different set id at a set number already logged", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    await t.log(0, 1, 5, 100);
    await rejectsWith(t.log(0, 1, 6, 100), "conflict");
    assert.equal((await sessionRows(t.sessionId)).sets, 1);
  });

  it("refuses a planned exercise from a different workout", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const request = t.request(0, 1, 5, 100);
    request.sessionExercise.plannedExerciseId = workouts[1]!.exercises[0]!.id;
    await rejectsWith(logSet(db, user, newId(), request), "invalid");
    assert.equal((await sessionRows(t.sessionId)).exercises, 0);
  });
});

describe("editSet", () => {
  it("changes reps and nothing else, keeping the stamped unit", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const sets = [];
    for (let n = 1; n <= 3; n++) sets.push(await t.log(0, n, 5, 100, "KG"));
    const se = sets[0]!.sessionExerciseId;
    const before = await setsOf(se);

    const edited = await editSet(db, user, sets[1]!.id, {
      reps: 4,
      weight: 100,
    });

    assert.equal(edited.reps, 4);
    assert.equal(edited.setNumber, 2);
    assert.equal(edited.weightUnit, "KG");
    assert.equal(edited.loggedAt, sets[1]!.loggedAt);
    const afterwards = await setsOf(se);
    assert.equal(afterwards[1]!.reps, 4);
    assert.deepEqual(afterwards[0], before[0], "set 1 untouched");
    assert.deepEqual(afterwards[2], before[2], "set 3 untouched");
  });

  it("takes a unit when one is sent", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const set = await t.log(0, 1, 5, 100, "LB");
    const edited = await editSet(db, user, set.id, {
      reps: 5,
      weight: 45,
      weightUnit: "KG",
    });
    assert.equal(edited.weightUnit, "KG");
    assert.equal(edited.weight, 45);
  });

  it("replays to the same row and the same answer", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const set = await t.log(0, 1, 5, 100);
    const input = { reps: 3, weight: 102.5 };
    const first = await editSet(db, user, set.id, input);
    const second = await editSet(db, user, set.id, input);
    assert.deepEqual(second, first);
    assert.equal(first.weight, 102.5);
    assert.equal((await setsOf(set.sessionExerciseId)).length, 1);
  });

  it("answers not_found for a missing set and for another user's, changing nothing", async () => {
    const owner = await newUser();
    const a = await startTemplate(owner);
    const victim = await Training.start(owner, a.workouts[0]!);
    const theirs = await victim.log(0, 1, 5, 100);
    const [before] = await setsOf(theirs.sessionExerciseId);

    const intruder = await newUser();
    const missing = await rejectsWith(
      editSet(db, intruder, newId(), { reps: 1, weight: 1 }),
      "not_found",
    );
    const foreign = await rejectsWith(
      editSet(db, intruder, theirs.id, { reps: 1, weight: 1 }),
      "not_found",
    );
    assert.equal(foreign.message, missing.message, "indistinguishable");
    const [afterwards] = await setsOf(theirs.sessionExerciseId);
    assert.deepEqual(afterwards, before);
  });
});

describe("deleteSet", () => {
  it("removes a middle set and renumbers the survivors 1..n in order", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const sets = [];
    for (let n = 1; n <= 4; n++) sets.push(await t.log(0, n, n, 100));

    await deleteSet(db, user, sets[1]!.id);

    const rows = await setsOf(sets[0]!.sessionExerciseId);
    assert.deepEqual(
      rows.map((r) => [r.id, r.set_number, r.reps]),
      [
        [sets[0]!.id, 1, 1],
        [sets[2]!.id, 2, 3],
        [sets[3]!.id, 3, 4],
      ],
    );
    // The deferred unique was checked at the service's COMMIT; prove the
    // committed state also passes an immediate check.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query(
        "UPDATE session_sets SET set_number = set_number WHERE session_exercise_id = $1",
        [sets[0]!.sessionExerciseId],
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("logs the next set after a delete at the renumbered position", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const a = await t.log(0, 1, 5, 100);
    await t.log(0, 2, 5, 100);
    await deleteSet(db, user, a.id);
    await t.log(0, 2, 5, 100);
    assert.deepEqual(
      (await setsOf(a.sessionExerciseId)).map((r) => r.set_number),
      [1, 2],
    );
  });

  it("removes the session exercise with its only set, so it reads as skipped", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const only = await t.log(0, 1, 5, 100);

    await deleteSet(db, user, only.id);

    assert.deepEqual(await sessionRows(t.sessionId), {
      sessions: 1,
      exercises: 0,
      sets: 0,
    });
    const detail = sessionDetailResponse.parse(
      await getSession(db, user, t.sessionId),
    );
    const first = detail.exercises.find(
      (e) => e.plannedExerciseId === workouts[0]!.exercises[0]!.id,
    );
    assert.equal(first?.skipped, true);
  });

  it("replays as a no-op success", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    const a = await t.log(0, 1, 5, 100);
    const b = await t.log(0, 2, 5, 100);
    const c = await t.log(0, 3, 5, 100);

    assert.equal(await deleteSet(db, user, a.id), undefined);
    const once = await setsOf(a.sessionExerciseId);
    assert.equal(await deleteSet(db, user, a.id), undefined);
    const twice = await setsOf(a.sessionExerciseId);

    assert.deepEqual(twice, once, "nothing changed, not even xmin");
    assert.deepEqual(
      twice.map((r) => r.id),
      [b.id, c.id],
    );
  });

  it("treats another user's set as missing: success, nothing written", async () => {
    const owner = await newUser();
    const a = await startTemplate(owner);
    const victim = await Training.start(owner, a.workouts[0]!);
    const theirs = await victim.log(0, 1, 5, 100);
    const before = await setsOf(theirs.sessionExerciseId);

    const intruder = await newUser();
    await deleteSet(db, intruder, theirs.id);
    assert.deepEqual(await setsOf(theirs.sessionExerciseId), before);
  });
});

describe("skipping and resuming", () => {
  it("a skipped exercise has no session exercise row after the finish", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    await t.log(0, 1, 5, 100);
    await t.log(2, 1, 5, 100); // exercise 1 skipped
    await t.finish();

    assert.equal(
      await rowCount(
        "SELECT 1 FROM session_exercises WHERE session_id = $1 AND planned_exercise_id = $2",
        [t.sessionId, workouts[0]!.exercises[1]!.id],
      ),
      0,
    );
    const detail = sessionDetailResponse.parse(
      await getSession(db, user, t.sessionId),
    );
    assert.deepEqual(
      detail.exercises.map((e) => [e.position, e.skipped]),
      workouts[0]!.exercises.map((_, i) => [i, i !== 0 && i !== 2]),
    );
  });

  it("an unfinished session is offered for resumption with its sets", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    await t.log(0, 1, 5, 100);
    await t.log(0, 2, 5, 100);

    const next = await whatsNext(db, user);
    assert.deepEqual(
      next.inProgress.map((s) => s.sessionId),
      [t.sessionId],
    );
    const detail = await getSession(db, user, t.sessionId);
    assert.equal(detail.session.status, "IN_PROGRESS");
    assert.deepEqual(
      detail.exercises[0]!.sets.map((s) => s.setNumber),
      [1, 2],
    );
  });
});
