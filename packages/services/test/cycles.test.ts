// specs/program-builder, editing (operations.md 3.7, 3.8; step-4a design D4,
// D5, D7): the apply preview and saveCycle, against a real Neon branch.
// The race with a finish is forced with an open transaction holding the
// program lock, as test/finish.test.ts does.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { UserId } from "@workout-tracker/db";
import {
  applyPreviewResponse,
  saveCycleResponse,
  type SaveCycleRequest,
} from "@workout-tracker/shared";
import {
  activateProgram,
  createExercise,
  getApplyPreview,
  getCycle,
  saveCycle,
  whatsNext,
} from "../src/index";
import {
  Training,
  blockedBy,
  cleanup,
  db,
  newId,
  newUser,
  pool,
  rejectsWith,
} from "./db";
import {
  create,
  cycle,
  editable,
  fingerprints,
  fixtures,
  save,
  saveRequest,
  slot,
  workout,
  xmins,
} from "./trees";

after(cleanup);

/** The exercise names of cycle n, workout by workout. */
async function names(programId: string, n: number) {
  const { rows } = await pool.query<{ w: string; e: string | null }>(
    `SELECT w.name AS w, e.name AS e FROM workout_plans p
       JOIN workouts w ON w.plan_id = p.id
       JOIN planned_exercises pe ON pe.workout_id = w.id
       LEFT JOIN exercises e ON e.id = pe.exercise_id
      WHERE p.program_id = $1 AND p.cycle_number = $2
      ORDER BY w.position, pe.position`,
    [programId, n],
  );
  return rows.map((r) => `${r.w}:${r.e ?? "-"}`);
}

/** The ids of every row under cycle n, in tree order. */
async function idsOf(user: UserId, programId: string, n: number) {
  const c = await editable(user, programId, n);
  return c.workouts.flatMap((w) => [
    w.id,
    ...w.plannedExercises.flatMap((s) => [
      s.id,
      ...s.plannedSets.map((p) => p.id),
    ]),
  ]);
}

const faces = () => slot(1, { exercise: "Face Pull", sets: 3 });

async function statusOf(programId: string) {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM workout_programs WHERE id = $1",
    [programId],
  );
  return rows[0]!.status;
}

async function cycleNumbers(programId: string) {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT cycle_number AS n FROM workout_plans WHERE program_id = $1 ORDER BY cycle_number",
    [programId],
  );
  return rows.map((r) => r.n);
}

/** Finishes each of `ws` with one logged set. */
async function train(user: UserId, ws: Awaited<ReturnType<typeof fixtures>>) {
  for (const w of ws) {
    const t = await Training.start(user, w);
    await t.log(0, 1, 5, 100);
    await t.finish();
  }
}

describe("editing one cycle", () => {
  it("changes only that cycle (deload in cycle 3 of 4), keeping the ids of kept rows", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 4 });
    const fps = await fingerprints(user, programId);
    const ids = await idsOf(user, programId, 3);

    const { response } = await save(user, programId, 3, (c) => {
      for (const w of c.workouts) {
        for (const s of w.plannedExercises) {
          for (const p of s.plannedSets) p.targetWeight = 95;
        }
      }
    });

    assert.deepEqual(saveCycleResponse.parse(response), {
      cycleNumber: 3,
      applied: [],
    });
    const after = await fingerprints(user, programId);
    assert.equal(after[1], fps[1]);
    assert.equal(after[3], fps[3]);
    assert.notEqual(after[2], fps[2]);
    assert.deepEqual(
      await idsOf(user, programId, 3),
      ids,
      "same rows, updated in place",
    );
    const { rows } = await pool.query(
      `SELECT DISTINCT ps.target_weight::text AS w FROM planned_sets ps
         JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
         JOIN workouts w ON w.id = pe.workout_id
         JOIN workout_plans p ON p.id = w.plan_id
        WHERE p.program_id = $1 AND p.cycle_number = 3`,
      [programId],
    );
    assert.deepEqual(rows, [{ w: "95.00" }]);
  });

  it("reorders workouts, moves a slot between workouts and renumbers sets", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 1 });
    const keptSlot = (await editable(user, programId, 1)).workouts[0]!
      .plannedExercises[0]!;

    await save(user, programId, 1, (c) => {
      const [push, pull, legs] = c.workouts;
      push!.position = 2;
      legs!.position = 0;
      // Bench moves from Push to Pull, after the row.
      const bench = push!.plannedExercises.pop()!;
      bench.position = 1;
      // Its two prescribed sets swap numbers.
      bench.plannedSets[0]!.setNumber = 2;
      bench.plannedSets[1]!.setNumber = 1;
      bench.plannedSets[1]!.targetWeight = 145;
      pull!.plannedExercises.push(bench);
      push!.plannedExercises.push(slot(0, { label: "anything", sets: 2 }));
    });

    assert.deepEqual(await names(programId, 1), [
      "Legs:Back Squat",
      "Pull:Barbell Row",
      "Pull:Barbell Bench Press",
      "Push:-",
    ]);
    const after = await editable(user, programId, 1);
    const bench = after.workouts
      .find((w) => w.name === "Pull")!
      .plannedExercises.find((s) => s.id === keptSlot.id)!;
    assert.ok(bench, "the moved slot kept its id");
    assert.deepEqual(
      bench.plannedSets.map((p) => [p.id, p.setNumber, p.targetWeight]),
      [
        [keptSlot.plannedSets[1]!.id, 1, 145],
        [keptSlot.plannedSets[0]!.id, 2, 135],
      ],
    );
  });

  it("removes a workout and adds one", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 1 });
    await save(user, programId, 1, (c) => {
      c.workouts.splice(1, 1);
      c.workouts.push(workout(1, "Arms", [{ exercise: "Face Pull" }]));
    });
    assert.deepEqual(await names(programId, 1), [
      "Push:Barbell Bench Press",
      "Arms:Face Pull",
      "Legs:Back Squat",
    ]);
  });

  it("refuses another user's private exercise, naming the slot, and writes nothing", async () => {
    const owner = await newUser();
    const privateId = newId();
    await createExercise(db, owner, {
      id: privateId,
      name: "Secret Row",
      primaryMuscles: ["LATS"],
      secondaryMuscles: [],
      equipment: "MACHINE",
      metrics: [{ metric: "REPS", isRequired: true }],
    });
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 2 });
    const before = await xmins(programId);
    const error = await rejectsWith(
      save(user, programId, 1, (c) => {
        c.workouts[1]!.plannedExercises[0]!.exerciseId = privateId;
      }),
      "invalid",
    );
    assert.match(error.message, /Pull, exercise 1/);
    assert.deepEqual(await xmins(programId), before);
  });
});

describe("effort targets, RIR or RPE (design D16)", () => {
  /** Back Squat's (RPE, RIR) per set in cycle n, as `getCycle` returns them. */
  async function squatEfforts(user: UserId, programId: string, n: number) {
    const c = await editable(user, programId, n);
    const squat = c.workouts[0]!.plannedExercises[0]!;
    return squat.plannedSets.map((p) => [p.targetRpe, p.targetRir]);
  }

  /** The stored (target_rpe, target_rir) text of Back Squat in cycle n. */
  async function storedEfforts(programId: string, n: number) {
    const { rows } = await pool.query<{
      rpe: string | null;
      rir: string | null;
    }>(
      `SELECT ps.target_rpe::text AS rpe, ps.target_rir::text AS rir
         FROM planned_sets ps
         JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
         JOIN workouts w ON w.id = pe.workout_id
         JOIN workout_plans p ON p.id = w.plan_id
        WHERE p.program_id = $1 AND p.cycle_number = $2 AND w.name = 'Legs'
        ORDER BY ps.set_number`,
      [programId, n],
    );
    return rows.map((r) => [r.rpe, r.rir]);
  }

  it("round-trips through create, the cycle read, save and an apply to later cycles", async () => {
    const user = await newUser();
    // "5 x 225 lb, RIR 2" on set 3 (specs/program-builder, "RIR target").
    const five = { targetRepsMin: 5, targetRepsMax: 5, targetWeight: 225 };
    const legs = workout(0, "Legs", [
      {
        exercise: "Back Squat",
        sets: 3,
        prescribed: [
          { ...five, weightUnit: "LB" },
          { ...five, weightUnit: "LB", targetRpe: 8 },
          { ...five, weightUnit: "LB", targetRir: 2 },
        ],
      },
    ]);
    const { programId } = await create(user, {
      targetCycles: 3,
      cycle: cycle([legs]),
    });

    // Create wrote cycle 1 and cloned it into 2 and 3, targets as written.
    for (const n of [1, 2, 3]) {
      assert.deepEqual(
        await squatEfforts(user, programId, n),
        [
          [null, null],
          [8, null],
          [null, 2],
        ],
        `cycle ${n} read`,
      );
    }
    assert.deepEqual(await storedEfforts(programId, 2), [
      [null, null],
      ["8.0", null],
      [null, "2.0"],
    ]);

    // Save cycle 1: set 1 gains RIR 1.5, set 2 swaps RPE 8 for RIR 3, set 3
    // swaps RIR 2 for RPE 8.5. Applied to cycle 3, not cycle 2.
    const { response } = await save(
      user,
      programId,
      1,
      (c) => {
        const [s1, s2, s3] = c.workouts[0]!.plannedExercises[0]!.plannedSets;
        s1!.targetRir = 1.5;
        s2!.targetRpe = null;
        s2!.targetRir = 3;
        s3!.targetRir = null;
        s3!.targetRpe = 8.5;
      },
      [3],
    );
    assert.deepEqual(response, { cycleNumber: 1, applied: [3] });

    const edited = [
      [null, 1.5],
      [null, 3],
      [8.5, null],
    ];
    assert.deepEqual(await squatEfforts(user, programId, 1), edited);
    assert.deepEqual(await squatEfforts(user, programId, 3), edited, "cloned");
    assert.deepEqual(await storedEfforts(programId, 3), [
      [null, "1.5"],
      [null, "3.0"],
      ["8.5", null],
    ]);
    assert.deepEqual(
      await squatEfforts(user, programId, 2),
      [
        [null, null],
        [8, null],
        [null, 2],
      ],
      "cycle 2 untouched",
    );
    const fps = await fingerprints(user, programId);
    assert.equal(fps[0], fps[2]);
    assert.notEqual(fps[0], fps[1]);
  });
});

describe("apply to later cycles", () => {
  it("adds Face Pulls to cycle 5 of 12 and cycles 6-12, not 1-4", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 12 });
    const later = [6, 7, 8, 9, 10, 11, 12];

    const { response } = await save(
      user,
      programId,
      5,
      (c) => c.workouts[1]!.plannedExercises.push(faces()),
      later,
    );

    assert.deepEqual(response, { cycleNumber: 5, applied: later });
    const fps = await fingerprints(user, programId);
    assert.equal(new Set(fps.slice(4)).size, 1, "cycles 5-12 identical");
    assert.equal(new Set(fps.slice(0, 4)).size, 1);
    assert.notEqual(fps[0], fps[4]);
    assert.ok((await names(programId, 12)).includes("Pull:Face Pull"));
    assert.ok(!(await names(programId, 4)).includes("Pull:Face Pull"));
  });

  it("flags an authored cycle 9, pre-selects a notes-only cycle 7, and replaces 9 when the user overrides", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 12 });
    await save(user, programId, 9, (c) => {
      c.workouts[0]!.plannedExercises[0]!.plannedSets[0]!.targetWeight = 95;
    });
    await save(user, programId, 7, (c) => {
      c.workouts[0]!.notes = "go light if tired";
      c.workouts[2]!.plannedExercises[0]!.notes = "belt";
    });

    const preview = applyPreviewResponse.parse(
      await getApplyPreview(db, user, programId, 5),
    );
    assert.deepEqual(
      preview.later.map((l) => [l.cycleNumber, l.matches, l.trained]),
      [6, 7, 8, 9, 10, 11, 12].map((n) => [n, n !== 9, false]),
    );

    // The user ticks 9 anyway.
    const c = await editable(user, programId, 5);
    c.workouts[1]!.plannedExercises.push(faces());
    await saveCycle(
      db,
      user,
      programId,
      5,
      saveRequest(preview, c, [6, 7, 8, 9, 10, 11, 12]),
    );
    const fps = await fingerprints(user, programId);
    assert.equal(fps[8], fps[4], "cycle 9 replaced like the others");
  });

  it("carries a notes-only edit to the chosen cycles", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 3 });
    await save(
      user,
      programId,
      1,
      (c) => {
        c.workouts[0]!.notes = "Rest 3 min on bench";
      },
      [2, 3],
    );
    const { rows } = await pool.query(
      `SELECT p.cycle_number AS n, w.notes FROM workouts w
         JOIN workout_plans p ON p.id = w.plan_id
        WHERE p.program_id = $1 AND w.position = 0 ORDER BY p.cycle_number`,
      [programId],
    );
    assert.deepEqual(
      rows,
      [1, 2, 3].map((n) => ({ n, notes: "Rest 3 min on bench" })),
    );
  });

  it("is a no-op when retried after it succeeded: same answer, no row rewritten", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 12 });
    const later = [6, 7, 8, 9, 10, 11, 12];
    const { response, request } = await save(
      user,
      programId,
      5,
      (c) => c.workouts[1]!.plannedExercises.push(faces()),
      later,
    );
    const before = await xmins(programId);

    const again = await saveCycle(db, user, programId, 5, request);

    assert.deepEqual(again, response);
    assert.deepEqual(await xmins(programId), before);
  });

  it("refuses a retry once another device changed notes since, rather than overwriting them (design D7)", async () => {
    // The edited cycle (1), then an apply target (2), each on its own program.
    for (const n of [1, 2]) {
      const user = await newUser();
      const { programId } = await create(user, { targetCycles: 3 });
      const { request } = await save(
        user,
        programId,
        1,
        (c) => c.workouts[1]!.plannedExercises.push(faces()),
        [2],
      );
      const pushNotes = `FROM workout_plans p
        WHERE p.id = w.plan_id AND p.program_id = $1 AND p.cycle_number = $2
          AND w.position = 0`;
      await pool.query(
        `UPDATE workouts w SET notes = 'from the other device' ${pushNotes}`,
        [programId, n],
      );
      const before = await xmins(programId);

      const error = await rejectsWith(
        saveCycle(db, user, programId, 1, request),
        "conflict",
      );

      assert.match(error.message, /Reload and try again/, `cycle ${n}`);
      assert.deepEqual(await xmins(programId), before, `cycle ${n}`);
      const { rows } = await pool.query(
        `SELECT w.notes FROM workouts w, workout_plans p
          WHERE p.id = w.plan_id AND p.program_id = $1 AND p.cycle_number = $2
            AND w.position = 0`,
        [programId, n],
      );
      assert.deepEqual(rows, [{ notes: "from the other device" }]);
    }
  });

  it("refuses a target that became trained after the preview, writing nothing", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 8 });
    await activateProgram(db, user, programId);
    const before = await fingerprints(user, programId);
    let rows: Record<string, string> = {};

    const error = await rejectsWith(
      save(
        user,
        programId,
        5,
        (c) => c.workouts[1]!.plannedExercises.push(faces()),
        [6, 7, 8],
        async () => {
          const [push] = await fixtures(user, programId, 6);
          await Training.start(user, push!);
          rows = await xmins(programId);
        },
      ),
      "conflict",
    );

    assert.match(error.message, /Reload and try again/);
    assert.deepEqual(await fingerprints(user, programId), before);
    assert.deepEqual(await xmins(programId), rows);
  });

  it("refuses when the edited cycle changed after the preview", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 3 });
    const preview = await getApplyPreview(db, user, programId, 1);
    const c = await editable(user, programId, 1);
    // Someone else's save lands first.
    await save(user, programId, 1, (x) => {
      x.workouts[0]!.name = "Chest";
    });
    c.workouts[2]!.name = "Lower";
    await rejectsWith(
      saveCycle(db, user, programId, 1, saveRequest(preview, c, [])),
      "conflict",
    );
    assert.deepEqual(
      (await editable(user, programId, 1)).workouts.map((w) => w.name),
      ["Chest", "Pull", "Legs"],
    );
  });

  it("refuses an apply target that isn't a later cycle", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 4 });
    const preview = await getApplyPreview(db, user, programId, 2);
    const c = await editable(user, programId, 2);
    const request = saveRequest(preview, c, []);
    request.applyTo = [{ cycleNumber: 1, fingerprint: preview.source }];
    await rejectsWith(saveCycle(db, user, programId, 2, request), "invalid");
  });
});

describe("trained workouts are frozen", () => {
  async function trainedPush(targetCycles = 4) {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles });
    await activateProgram(db, user, programId);
    const [push] = await fixtures(user, programId, 1);
    const t = await Training.start(user, push!);
    await t.log(0, 1, 5, 135);
    await t.finish();
    return { user, programId };
  }

  it("saves a mid-cycle tweak to Legs and leaves the trained Push alone", async () => {
    const { user, programId } = await trainedPush();
    const pushBefore = (await editable(user, programId, 1)).workouts[0];
    await save(user, programId, 1, (c) => {
      c.workouts[2]!.plannedExercises[0]!.targetSets = 5;
    });
    const after = await editable(user, programId, 1);
    assert.deepEqual(after.workouts[0], pushBefore);
    assert.equal(after.workouts[2]!.plannedExercises[0]!.targetSets, 5);
  });

  it("refuses any change to a trained workout, naming it, and writes nothing", async () => {
    const { user, programId } = await trainedPush();
    const before = await xmins(programId);
    const edits: ((c: Awaited<ReturnType<typeof editable>>) => void)[] = [
      (c) => void (c.workouts[0]!.plannedExercises[0]!.targetSets = 4),
      (c) => void (c.workouts[0]!.notes = "new note"),
      (c) => void c.workouts.shift(),
      (c) => void c.workouts[0]!.plannedExercises.push(faces()),
      // Moving a slot out of it is a change to it as well.
      (c) => {
        const bench = c.workouts[0]!.plannedExercises.pop()!;
        bench.position = 5;
        c.workouts[1]!.plannedExercises.push(bench);
      },
    ];
    for (const edit of edits) {
      const error = await rejectsWith(
        save(user, programId, 1, edit),
        "conflict",
      );
      assert.match(error.message, /^Push /);
    }
    assert.deepEqual(await xmins(programId), before);
  });

  it("refuses a new workout or slot in a COMPLETED program, and writes nothing", async () => {
    const { user, programId } = await trainedPush(1);
    const [, pull, legs] = await fixtures(user, programId, 1);
    for (const w of [pull!, legs!]) {
      const t = await Training.start(user, w);
      await t.log(0, 1, 5, 100);
      await t.finish();
    }
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM workout_programs WHERE id = $1",
      [programId],
    );
    assert.equal(rows[0]!.status, "COMPLETED");
    const before = await xmins(programId);

    for (const edit of [
      (c: Awaited<ReturnType<typeof editable>>) =>
        void c.workouts.push(workout(3, "Arms", [{ exercise: "Face Pull" }])),
      (c: Awaited<ReturnType<typeof editable>>) =>
        void c.workouts[2]!.plannedExercises.push(faces()),
    ]) {
      const error = await rejectsWith(
        save(user, programId, 1, edit),
        "invalid",
      );
      assert.equal(
        error.message,
        "This program is finished. Run another cycle to change it.",
      );
    }
    assert.deepEqual(await xmins(programId), before);
    assert.deepEqual((await whatsNext(db, user)).next, []);
  });

  it("refuses a reorder across a trained workout, and an insert before it", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 2 });
    await activateProgram(db, user, programId);
    const [, pull] = await fixtures(user, programId, 1);
    await Training.start(user, pull!); // IN_PROGRESS is trained too
    const before = await xmins(programId);

    // Legs (after Pull) swaps with Push (before Pull): Pull keeps position 1.
    const across = await rejectsWith(
      save(user, programId, 1, (c) => {
        c.workouts[0]!.position = 2;
        c.workouts[2]!.position = 0;
      }),
      "conflict",
    );
    assert.match(across.message, /Pull/);
    assert.match(across.message, /Legs|Push/);

    // Pull keeps its place but must move to let Arms in: refused as a move.
    const moved = await rejectsWith(
      save(user, programId, 1, (c) => {
        c.workouts[1]!.position = 2;
        c.workouts[2]!.position = 3;
        c.workouts.push(workout(1, "Arms", [{ exercise: "Face Pull" }]));
      }),
      "conflict",
    );
    assert.match(moved.message, /^Pull /);

    // Push replaced by a new workout before Pull: an insert before it.
    const insert = await rejectsWith(
      save(user, programId, 1, (c) => {
        c.workouts[0] = workout(0, "Arms", [{ exercise: "Face Pull" }]);
      }),
      "conflict",
    );
    assert.match(insert.message, /Arms can't go before Pull/);
    assert.deepEqual(await xmins(programId), before);

    // After it is fine.
    await save(user, programId, 1, (c) => {
      c.workouts.push(workout(3, "Arms", [{ exercise: "Face Pull" }]));
    });
    assert.equal((await editable(user, programId, 1)).workouts.length, 4);
  });

  it("locks trained cycles in the preview", async () => {
    const { user, programId } = await trainedPush();
    await save(user, programId, 2, (c) => {
      c.workouts[0]!.name = "Chest";
    });
    const [push3] = await fixtures(user, programId, 3);
    await Training.start(user, push3!);
    const preview = await getApplyPreview(db, user, programId, 1);
    assert.deepEqual(
      preview.later.map((l) => [l.cycleNumber, l.trained, l.matches]),
      [
        [2, false, false],
        [3, true, true],
        [4, false, true],
      ],
    );
  });
});

describe("a save racing a finish", () => {
  it("serializes on the program lock: the finish sees the saved workout and does not complete the program", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 1 });
    await activateProgram(db, user, programId);
    const [push, pull, legs] = await fixtures(user, programId, 1);
    for (const w of [push!, pull!]) {
      const t = await Training.start(user, w);
      await t.log(0, 1, 5, 100);
      await t.finish();
    }
    const last = await Training.start(user, legs!);
    await last.log(0, 1, 5, 100);

    const preview = await getApplyPreview(db, user, programId, 1);
    const c = await editable(user, programId, 1);
    c.workouts.push(workout(3, "Arms", [{ exercise: "Face Pull" }]));
    const request = saveRequest(preview, c, []);

    const holder = await pool.connect();
    let finished;
    try {
      await holder.query("BEGIN");
      const { rows } = await holder.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const holderPid = rows[0]!.pid;
      await holder.query(
        "SELECT 1 FROM workout_programs WHERE id = $1 FOR UPDATE",
        [programId],
      );

      const saving = saveCycle(db, user, programId, 1, request);
      const savePid = await blockedBy([holderPid]);
      const finishing = last.finish();
      await blockedBy([holderPid, savePid], [savePid]);
      await holder.query("COMMIT");
      const [saved, done] = await Promise.all([saving, finishing]);
      assert.deepEqual(saved, { cycleNumber: 1, applied: [] });
      finished = done;
    } finally {
      holder.release();
    }

    assert.equal(finished.extended, false);
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM workout_programs WHERE id = $1",
      [programId],
    );
    assert.equal(rows[0]!.status, "ACTIVE", "Arms is still to do");
    const next = await whatsNext(db, user);
    assert.deepEqual(
      next.next.map((n) => [n.workoutName, n.cycleNumber]),
      [["Arms", 1]],
    );
  });
});

describe("a save rolls the program over (design D8)", () => {
  it("completes a fixed program when it removes the last unresolved workout", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 1 });
    await activateProgram(db, user, programId);
    const [push, pull] = await fixtures(user, programId, 1);
    await train(user, [push!, pull!]);

    await save(user, programId, 1, (c) => void c.workouts.pop());

    assert.equal(await statusOf(programId), "COMPLETED");
    assert.deepEqual(await cycleNumbers(programId), [1]);
    assert.deepEqual((await whatsNext(db, user)).next, []);
  });

  it("gives an open-ended program its next cycle; a retried save adds nothing", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: null });
    await activateProgram(db, user, programId);
    const [push, pull] = await fixtures(user, programId, 1);
    await train(user, [push!, pull!]);

    const { response, request } = await save(
      user,
      programId,
      1,
      (c) => void c.workouts.pop(),
    );

    assert.deepEqual(response, { cycleNumber: 1, applied: [] });
    assert.equal(await statusOf(programId), "ACTIVE");
    assert.deepEqual(await cycleNumbers(programId), [1, 2]);
    const next = await whatsNext(db, user);
    assert.deepEqual(
      next.next.map((n) => [n.workoutName, n.cycleNumber]),
      [["Push", 2]],
    );
    assert.deepEqual(
      (await editable(user, programId, 2)).workouts.map((w) => w.name),
      ["Push", "Pull"],
    );

    const before = await xmins(programId);
    assert.deepEqual(
      await saveCycle(db, user, programId, 1, request),
      response,
    );
    assert.deepEqual(await xmins(programId), before);
    assert.deepEqual(await cycleNumbers(programId), [1, 2]);
  });

  it("leaves an ordinary save alone: nothing added, still ACTIVE", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: null });
    await activateProgram(db, user, programId);
    const [push] = await fixtures(user, programId, 1);
    await train(user, [push!]);

    await save(user, programId, 1, (c) => {
      c.workouts[2]!.plannedExercises[0]!.targetSets = 5;
    });

    assert.equal(await statusOf(programId), "ACTIVE");
    assert.deepEqual(await cycleNumbers(programId), [1]);
    assert.equal((await whatsNext(db, user)).next[0]!.workoutName, "Pull");
  });
});

describe("the load-to-save stale guard (design D7, D17)", () => {
  it("reads the cycle's fingerprint with its tree, the one the preview shows", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 3 });
    const read = await getCycle(db, user, programId, 2);
    const preview = await getApplyPreview(db, user, programId, 2);
    assert.equal(read.fingerprint, preview.source);
    assert.equal(read.fingerprint, (await fingerprints(user, programId))[1]);
  });

  it("refuses a save when another device saved the cycle after it was loaded", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 3 });
    const loaded = await getCycle(db, user, programId, 1);
    const c = await editable(user, programId, 1);

    // Another device edits and saves cycle 1 in between.
    await save(user, programId, 1, (x) => {
      x.workouts[0]!.name = "Chest";
    });

    // This device previews only now, so the preview's source is already the
    // other device's; the load fingerprint is what catches it.
    const preview = await getApplyPreview(db, user, programId, 1);
    c.workouts[2]!.name = "Lower";
    const request = saveRequest(preview, c, []);
    request.expected.source = loaded.fingerprint;
    const before = await xmins(programId);

    const error = await rejectsWith(
      saveCycle(db, user, programId, 1, request),
      "conflict",
    );
    assert.match(error.message, /Reload and try again/);
    assert.deepEqual(await xmins(programId), before);
    assert.deepEqual(
      (await editable(user, programId, 1)).workouts.map((w) => w.name),
      ["Chest", "Pull", "Legs"],
    );
  });

  it("saves when nothing changed since the load", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 3 });
    const loaded = await getCycle(db, user, programId, 1);
    const c = await editable(user, programId, 1);
    const preview = await getApplyPreview(db, user, programId, 1);
    c.workouts[2]!.name = "Lower";
    const request = saveRequest(preview, c, [2]);
    request.expected.source = loaded.fingerprint;

    await saveCycle(db, user, programId, 1, request);

    const fps = await fingerprints(user, programId);
    assert.equal(fps[1], fps[0]);
    assert.notEqual(fps[2], fps[0]);
  });
});

describe("a tree that never went through the contract", () => {
  it("is refused when it uses an id twice, writing nothing", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 2 });
    const preview = await getApplyPreview(db, user, programId, 1);
    const before = await xmins(programId);

    const cases: ((c: Awaited<ReturnType<typeof editable>>) => string)[] = [
      // A second workout under Legs' id.
      (c) => {
        const legs = c.workouts[2]!;
        c.workouts.push({ ...workout(3, "Arms", []), id: legs.id });
        return legs.id;
      },
      // Push's bench slot reused in Pull.
      (c) => {
        const bench = c.workouts[0]!.plannedExercises[0]!;
        c.workouts[1]!.plannedExercises.push({ ...bench, position: 5 });
        return bench.id;
      },
      // A prescribed set id used twice in one slot.
      (c) => {
        const sets = c.workouts[0]!.plannedExercises[0]!.plannedSets;
        sets.push({ ...sets[0]!, setNumber: 3 });
        return sets[0]!.id;
      },
    ];
    for (const edit of cases) {
      const c = await editable(user, programId, 1);
      const id = edit(c);
      // Built by hand, as an adapter that skipped `saveCycleRequest` would.
      const request: SaveCycleRequest = {
        cycle: c,
        expected: { source: preview.source },
        applyTo: [],
      };
      const error = await rejectsWith(
        saveCycle(db, user, programId, 1, request),
        "invalid",
      );
      assert.equal(error.message, `The id ${id} is used twice in this cycle.`);
    }
    assert.deepEqual(await xmins(programId), before);
  });
});

describe("a save racing a start", () => {
  it("waits on the workout lock, then sees the new session and refuses to change the workout", async () => {
    const user = await newUser();
    const { programId } = await create(user, { targetCycles: 2 });
    await activateProgram(db, user, programId);
    const [push] = await fixtures(user, programId, 1);

    const preview = await getApplyPreview(db, user, programId, 1);
    const c = await editable(user, programId, 1);
    c.workouts[0]!.name = "Chest";
    const request = saveRequest(preview, c, []);

    // A start that has inserted its session but not committed holds a
    // key-share lock on Push. A rename alone takes no lock that conflicts
    // with it, so only the save's FOR UPDATE on the cycle's workouts makes
    // it wait and then see Push as trained.
    const holder = await pool.connect();
    let saving: Promise<unknown>;
    try {
      await holder.query("BEGIN");
      const { rows } = await holder.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await holder.query(
        "INSERT INTO workout_sessions (id, user_id, workout_id, status) VALUES ($1, $2, $3, 'IN_PROGRESS')",
        [newId(), user, push!.id],
      );
      saving = saveCycle(db, user, programId, 1, request);
      saving.catch(() => undefined);
      await blockedBy([rows[0]!.pid]);
      await holder.query("COMMIT");
    } finally {
      holder.release();
    }

    const error = await rejectsWith(saving, "conflict");
    assert.equal(
      error.message,
      "Push already has a logged session, so it can't be changed or moved.",
    );
    assert.equal(
      (await editable(user, programId, 1)).workouts[0]!.name,
      "Push",
    );
  });
});
