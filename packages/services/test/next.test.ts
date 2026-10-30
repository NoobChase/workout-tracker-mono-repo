// What's next (operations.md 4.1) and the prefetched workout context (design
// D9), against a real Neon branch.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  whatsNextResponse,
  workoutContextResponse,
} from "@workout-tracker/shared";
import { activateProgram, getWorkoutContext, whatsNext } from "../src/index";
import {
  Training,
  cleanup,
  db,
  newId,
  newUser,
  pool,
  rejectsWith,
  startTemplate,
} from "./db";
import { create, cycle, ex, fixtures, workout } from "./trees";

after(cleanup);

describe("whatsNext", () => {
  it("shows a fresh program's first workout of cycle 1", async () => {
    const user = await newUser();
    const { programId, workouts } = await startTemplate(user);
    const next = whatsNextResponse.parse(await whatsNext(db, user));
    assert.deepEqual(next, {
      next: [
        {
          programId,
          programName: "Push Pull Legs",
          workoutId: workouts[0]!.id,
          workoutName: "Push",
          cycleNumber: 1,
        },
      ],
      inProgress: [],
    });
  });

  it("moves to the second workout once the first is finished", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    await t.log(0, 1, 5, 100);
    await t.finish();
    const next = await whatsNext(db, user);
    assert.equal(next.next[0]!.workoutId, workouts[1]!.id);
    assert.equal(next.next[0]!.cycleNumber, 1);
  });

  it("keeps a workout with only an abandoned IN_PROGRESS session as next", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const t = await Training.start(user, workouts[0]!);
    await t.log(0, 1, 5, 100);
    const next = await whatsNext(db, user);
    assert.equal(next.next[0]!.workoutId, workouts[0]!.id);
    assert.deepEqual(
      next.inProgress.map((s) => [s.sessionId, s.workoutId, s.workoutName]),
      [[t.sessionId, workouts[0]!.id, "Push"]],
    );
  });

  it("treats a SKIPPED session as resolved", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user);
    await pool.query(
      "INSERT INTO workout_sessions (id, user_id, workout_id, status) VALUES ($1, $2, $3, 'SKIPPED')",
      [newId(), user, workouts[0]!.id],
    );
    const next = await whatsNext(db, user);
    assert.equal(next.next[0]!.workoutId, workouts[1]!.id);
  });

  it("lists one workout per active program, and never another user's", async () => {
    const other = await newUser();
    await startTemplate(other, "upper-lower-4-day");
    const user = await newUser();
    const a = await startTemplate(user, "push-pull-legs");
    const b = await startTemplate(user, "full-body-3-day");
    const archived = await startTemplate(user, "upper-lower-4-day");
    await pool.query(
      "UPDATE workout_programs SET status = 'ARCHIVED' WHERE id = $1",
      [archived.programId],
    );

    const next = await whatsNext(db, user);
    assert.deepEqual(
      next.next.map((n) => n.workoutId).sort(),
      [a.workouts[0]!.id, b.workouts[0]!.id].sort(),
    );
    const otherNext = await whatsNext(db, other);
    assert.equal(otherNext.next.length, 1);
    assert.equal(otherNext.next[0]!.programName, "Upper Lower 4-Day");
  });

  it("does not show another user's in-progress sessions", async () => {
    const other = await newUser();
    const o = await startTemplate(other);
    await Training.start(other, o.workouts[0]!);
    const user = await newUser();
    await startTemplate(user);
    assert.deepEqual((await whatsNext(db, user)).inProgress, []);
  });
});

describe("getWorkoutContext", () => {
  it("returns the plan with names, metrics, targets and the user's units", async () => {
    const user = await newUser("KG");
    const { programId, workouts } = await startTemplate(user);
    const override = workouts[0]!.exercises[2]!.exerciseId;
    await pool.query(
      `INSERT INTO user_exercise_settings (id, user_id, exercise_id, default_weight_unit)
       VALUES ($1, $2, $3, 'LB')`,
      [newId(), user, override],
    );

    const ctx = workoutContextResponse.parse(
      await getWorkoutContext(db, user, workouts[0]!.id),
    );

    assert.deepEqual(ctx.workout, {
      id: workouts[0]!.id,
      name: "Push",
      position: 0,
      cycleNumber: 1,
      programId,
      programName: "Push Pull Legs",
    });
    assert.deepEqual(ctx.units, {
      default: "KG",
      overrides: { [override]: "LB" },
    });
    assert.deepEqual(
      ctx.exercises.map((e) => [e.plannedExerciseId, e.position]),
      workouts[0]!.exercises.map((e, i) => [e.id, i]),
    );
    const bench = ctx.exercises[0]!;
    assert.ok(bench.name && bench.name.length > 0);
    assert.ok(
      bench.metrics.includes("WEIGHT") && bench.metrics.includes("REPS"),
    );
    assert.equal(bench.targetSets, 3);
    assert.deepEqual(bench.plannedSets, [
      {
        setNumber: 1,
        repsMin: 5,
        repsMax: 8,
        weight: null,
        weightUnit: null,
        targetRpe: null,
        targetRir: null,
      },
      {
        setNumber: 2,
        repsMin: 5,
        repsMax: 8,
        weight: null,
        weightUnit: null,
        targetRpe: null,
        targetRir: null,
      },
      {
        setNumber: 3,
        repsMin: 5,
        repsMax: 8,
        weight: null,
        weightUnit: null,
        targetRpe: null,
        targetRir: null,
      },
    ]);
    assert.equal(bench.lastTime, null, "first time: no previous numbers");
  });

  it("shows last time's counted sets from the most recent COMPLETED session, from any workout", async () => {
    const user = await newUser();
    const { workouts } = await startTemplate(user, "full-body-3-day");
    // Back Squat, exercise 0 of Full Body A.
    const squat = workouts[0]!.exercises[0]!.exerciseId;

    const older = await Training.start(
      user,
      workouts[0]!,
      "2026-10-01T10:00:00.000Z",
    );
    await older.log(0, 1, 5, 205);
    await older.finish();

    const newer = await Training.start(
      user,
      workouts[0]!,
      "2026-10-08T10:00:00.000Z",
    );
    const warmup = await newer.log(0, 1, 5, 135);
    await pool.query("UPDATE session_sets SET kind = 'WARMUP' WHERE id = $1", [
      warmup.id,
    ]);
    await newer.log(0, 2, 5, 225);
    await newer.log(0, 3, 5, 225);
    await newer.finish();

    // An unfinished session afterwards does not count as "last time".
    const open = await Training.start(
      user,
      workouts[0]!,
      "2026-10-15T10:00:00.000Z",
    );
    await open.log(0, 1, 1, 315);

    // Ask from a different workout row that also has the squat: a second
    // program's Full Body A.
    const again = await startTemplate(user, "full-body-3-day");
    const ctx = await getWorkoutContext(db, user, again.workouts[0]!.id);
    const entry = ctx.exercises.find((e) => e.exerciseId === squat)!;
    assert.deepEqual(entry.lastTime, {
      sessionId: newer.sessionId,
      performedAt: "2026-10-08T10:00:00.000Z",
      sets: [
        { setNumber: 2, reps: 5, weight: 225, weightUnit: "LB" },
        { setNumber: 3, reps: 5, weight: 225, weightUnit: "LB" },
      ],
    });
  });

  it("never shows another user's sets as last time", async () => {
    const other = await newUser();
    const o = await startTemplate(other);
    const t = await Training.start(other, o.workouts[0]!);
    await t.log(0, 1, 5, 225);
    await t.finish();

    const user = await newUser();
    const { workouts } = await startTemplate(user);
    const ctx = await getWorkoutContext(db, user, workouts[0]!.id);
    assert.ok(ctx.exercises.every((e) => e.lastTime === null));
  });

  it("is not_found for another user's workout, as for a missing one", async () => {
    const owner = await newUser();
    const { workouts } = await startTemplate(owner);
    const user = await newUser();
    const foreign = await rejectsWith(
      getWorkoutContext(db, user, workouts[0]!.id),
      "not_found",
    );
    const missing = await rejectsWith(
      getWorkoutContext(db, user, newId()),
      "not_found",
    );
    assert.equal(foreign.message, missing.message);
  });
});

// Step-4a: placeholders and slots the logger can't log yet (design D12), and
// a fixed program completing on its last finish (specs/workout-sessions).
describe("getWorkoutContext with effort targets", () => {
  it("returns a set's RIR and another's RPE as numbers, null where unset", async () => {
    const user = await newUser();
    const { programId } = await create(user, {
      targetCycles: 1,
      cycle: cycle([
        workout(0, "Heavy", [
          {
            exercise: "Barbell Bench Press",
            sets: 3,
            prescribed: [
              { targetRepsMin: 5, targetRepsMax: 5, targetRir: 2 },
              { targetRepsMin: 5, targetRepsMax: 5, targetRpe: 8.5 },
              { targetRepsMin: 5, targetRepsMax: 5 },
            ],
          },
        ]),
      ]),
    });
    const [heavy] = await fixtures(user, programId, 1);

    const ctx = workoutContextResponse.parse(
      await getWorkoutContext(db, user, heavy!.id),
    );

    assert.deepEqual(
      ctx.exercises[0]!.plannedSets.map((s) => [
        s.setNumber,
        s.targetRpe,
        s.targetRir,
      ]),
      [
        [1, null, 2],
        [2, 8.5, null],
        [3, null, null],
      ],
    );
  });
});

describe("getWorkoutContext with placeholders", () => {
  it("returns every slot in position order: a placeholder with its label, Plank with its metrics", async () => {
    const user = await newUser();
    const { programId } = await create(user, {
      targetCycles: 1,
      cycle: cycle([
        workout(0, "Mixed", [
          { exercise: "Barbell Bench Press", sets: 3 },
          { label: "conditioning finisher", sets: 2 },
          { exercise: "Plank", sets: 3 },
        ]),
      ]),
    });
    const [mixed] = await fixtures(user, programId, 1);

    const ctx = workoutContextResponse.parse(
      await getWorkoutContext(db, user, mixed!.id),
    );

    assert.deepEqual(
      ctx.exercises.map((e) => [
        e.position,
        e.exerciseId,
        e.name,
        e.placeholderLabel,
        e.targetSets,
      ]),
      [
        [0, ex("Barbell Bench Press"), "Barbell Bench Press", null, 3],
        [1, null, null, "conditioning finisher", 2],
        [2, ex("Plank"), "Plank", null, 3],
      ],
    );
    const [, placeholder, plank] = ctx.exercises;
    assert.deepEqual(placeholder!.metrics, []);
    assert.equal(placeholder!.lastTime, null);
    assert.ok(plank!.metrics.includes("DURATION"));
    assert.ok(!plank!.metrics.includes("REPS"));
  });

  it("finishes a workout whose placeholder and Plank were skipped, with no rows for them", async () => {
    const user = await newUser();
    const { programId } = await create(user, {
      targetCycles: null,
      cycle: cycle([
        workout(0, "Mixed", [
          { exercise: "Barbell Bench Press", sets: 1 },
          { label: "conditioning finisher", sets: 2 },
          { exercise: "Plank", sets: 3 },
        ]),
      ]),
    });
    await activateProgram(db, user, programId);
    const [mixed] = await fixtures(user, programId, 1);
    const t = await Training.start(user, mixed!);
    await t.log(0, 1, 5, 135);

    assert.equal((await t.finish()).status, "COMPLETED");
    const { rows } = await pool.query(
      `SELECT e.name FROM session_exercises se JOIN exercises e ON e.id = se.exercise_id
        WHERE se.session_id = $1`,
      [t.sessionId],
    );
    assert.deepEqual(rows, [{ name: "Barbell Bench Press" }]);
  });
});

describe("finishing a fixed program's last workout", () => {
  it("completes the program, adds no cycle, and drops it from what's next", async () => {
    const user = await newUser();
    const { programId } = await create(user, {
      targetCycles: 2,
      cycle: cycle([
        workout(0, "A", [{ exercise: "Back Squat", sets: 1 }]),
        workout(1, "B", [{ exercise: "Barbell Bench Press", sets: 1 }]),
      ]),
    });
    await activateProgram(db, user, programId);
    for (const n of [1, 2]) {
      for (const w of await fixtures(user, programId, n)) {
        assert.ok(
          (await whatsNext(db, user)).next.some(
            (x) => x.programId === programId,
          ),
        );
        const t = await Training.start(user, w);
        await t.log(0, 1, 5, 100);
        assert.equal((await t.finish()).extended, false);
      }
    }

    const { rows } = await pool.query<{
      status: string;
      target_cycles: number;
    }>("SELECT status, target_cycles FROM workout_programs WHERE id = $1", [
      programId,
    ]);
    assert.deepEqual(rows[0], { status: "COMPLETED", target_cycles: 2 });
    const { rows: plans } = await pool.query(
      "SELECT cycle_number FROM workout_plans WHERE program_id = $1 ORDER BY 1",
      [programId],
    );
    assert.deepEqual(plans, [{ cycle_number: 1 }, { cycle_number: 2 }]);
    assert.deepEqual((await whatsNext(db, user)).next, []);
  });
});
