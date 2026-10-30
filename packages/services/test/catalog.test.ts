// specs/exercise-catalog (step-4a, design D11), against a real Neon branch.
// Filtering by muscle, equipment and name is the client's (D11); here the
// list is checked for carrying what those filters read.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  equipment as dbEquipment,
  metricKind as dbMetricKind,
  muscleGroup as dbMuscleGroup,
  type UserId,
} from "@workout-tracker/db";
import {
  equipment,
  exerciseResponse,
  exercisesResponse,
  metricKind,
  muscleGroup,
  type CreateExerciseRequest,
} from "@workout-tracker/shared";
import {
  createExercise,
  editExercise,
  getSession,
  listExercises,
  logSet,
  reactivateExercise,
  retireExercise,
  saveExerciseNotes,
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

const BACK_SQUAT = "01a170d4-dadf-731e-8dc9-5c1432d8b0f8";

function reverseHyper(
  patch: Partial<CreateExerciseRequest> = {},
): CreateExerciseRequest {
  return {
    id: newId(),
    name: "Reverse Hyper",
    primaryMuscles: ["GLUTES"],
    secondaryMuscles: ["HAMSTRINGS", "LOWER_BACK"],
    equipment: "MACHINE",
    metrics: [
      { metric: "REPS", isRequired: true },
      { metric: "WEIGHT", isRequired: false },
    ],
    ...patch,
  };
}

async function list(user: UserId, includeRetired = false) {
  return exercisesResponse.parse(
    await listExercises(db, user, { includeRetired }),
  ).exercises;
}

async function xmins(table: string, column: string, id: string) {
  const { rows } = await pool.query<{ xmin: string }>(
    `SELECT xmin::text FROM ${table} WHERE ${column} = $1 ORDER BY xmin::text`,
    [id],
  );
  return rows.map((r) => r.xmin);
}

/** A completed session in which `exerciseId` was logged, off-plan. */
async function trainWith(user: UserId, exerciseId: string): Promise<string> {
  const { workouts } = await startTemplate(user);
  const t = await Training.start(user, workouts[0]!);
  const request = t.request(0, 1, 10, 25);
  await logSet(db, user, newId(), {
    ...request,
    sessionExercise: {
      ...request.sessionExercise,
      id: newId(),
      exerciseId,
      plannedExerciseId: null,
      position: 50,
    },
  });
  await t.finish();
  return t.sessionId;
}

describe("the shared enums", () => {
  it("mirror the database's", () => {
    assert.deepEqual(metricKind.options, dbMetricKind.enumValues);
    assert.deepEqual(muscleGroup.options, dbMuscleGroup.enumValues);
    assert.deepEqual(equipment.options, dbEquipment.enumValues);
  });
});

describe("listExercises", () => {
  it("lists standard and own active exercises by name, never another user's", async () => {
    const other = await newUser();
    await createExercise(db, other, reverseHyper({ name: "Jefferson Curl" }));
    const user = await newUser();
    await createExercise(db, user, reverseHyper());

    const exercises = await list(user);
    const names = exercises.map((e) => e.name);
    assert.ok(names.includes("Back Squat"));
    assert.ok(names.includes("Reverse Hyper"));
    assert.ok(!names.includes("Jefferson Curl"));
    // The database's collation decides "by name", so ask it for the order.
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM exercises
        WHERE (owner_user_id IS NULL AND is_active) OR owner_user_id = $1
        ORDER BY name, id`,
      [user],
    );
    assert.deepEqual(
      names,
      rows.map((r) => r.name),
      "every standard active exercise and the user's own, ordered by name",
    );
    assert.ok(exercises.every((e) => e.isActive));

    const squat = exercises.find((e) => e.id === BACK_SQUAT)!;
    assert.equal(squat.isCustom, false);
    assert.deepEqual(squat.primaryMuscles, ["QUADS", "GLUTES"]);
    assert.deepEqual(squat.secondaryMuscles, ["ADDUCTORS", "LOWER_BACK"]);
    assert.equal(squat.equipment, "BARBELL");
    assert.deepEqual(squat.metrics, [
      { metric: "REPS", isRequired: true },
      { metric: "WEIGHT", isRequired: true },
      { metric: "RPE", isRequired: false },
    ]);
  });
});

describe("listExercises units", () => {
  it("returns the user's default unit and per-exercise overrides, scoped to them", async () => {
    const user = await newUser("KG");
    const other = await newUser("LB");
    const settings = (owner: UserId, unit: string) =>
      pool.query(
        `INSERT INTO user_exercise_settings (id, user_id, exercise_id, default_weight_unit)
         VALUES ($1, $2, $3, $4)`,
        [newId(), owner, BACK_SQUAT, unit],
      );
    const read = async (u: UserId) =>
      exercisesResponse.parse(
        await listExercises(db, u, { includeRetired: false }),
      ).units;

    assert.deepEqual(await read(user), { default: "KG", overrides: {} });

    await settings(user, "LB");
    await settings(other, "KG");
    assert.deepEqual(await read(user), {
      default: "KG",
      overrides: { [BACK_SQUAT]: "LB" },
    });
    assert.deepEqual(await read(other), {
      default: "LB",
      overrides: { [BACK_SQUAT]: "KG" },
    });
  });

  it("leaves out a settings row that only holds notes", async () => {
    const user = await newUser();
    await saveExerciseNotes(db, user, BACK_SQUAT, {
      id: newId(),
      setup: "Bar low",
      cues: null,
    });
    const { units } = exercisesResponse.parse(
      await listExercises(db, user, { includeRetired: false }),
    );
    assert.deepEqual(units, { default: "LB", overrides: {} });
  });
});

describe("createExercise", () => {
  it("writes the exercise with REPS required and WEIGHT optional, and lists it", async () => {
    const user = await newUser();
    const input = reverseHyper();
    const created = exerciseResponse.parse(
      await createExercise(db, user, input),
    );
    assert.deepEqual(created.exercise, {
      id: input.id,
      name: "Reverse Hyper",
      isCustom: true,
      isActive: true,
      primaryMuscles: ["GLUTES"],
      secondaryMuscles: ["HAMSTRINGS", "LOWER_BACK"],
      equipment: "MACHINE",
      metrics: [
        { metric: "REPS", isRequired: true },
        { metric: "WEIGHT", isRequired: false },
      ],
      setup: null,
      cues: null,
    });
    assert.deepEqual(
      (await list(user)).find((e) => e.id === input.id),
      created.exercise,
    );
  });

  it("is idempotent on the id: one exercise, the same answer, nothing rewritten", async () => {
    const user = await newUser();
    const input = reverseHyper();
    const first = await createExercise(db, user, input);
    const before = {
      exercise: await xmins("exercises", "id", input.id),
      metrics: await xmins("exercise_metrics", "exercise_id", input.id),
    };

    const second = await createExercise(db, user, input);

    assert.deepEqual(second, first);
    assert.equal(
      await rowCount("SELECT 1 FROM exercises WHERE owner_user_id = $1", [
        user,
      ]),
      1,
    );
    assert.deepEqual(
      {
        exercise: await xmins("exercises", "id", input.id),
        metrics: await xmins("exercise_metrics", "exercise_id", input.id),
      },
      before,
      "the replay wrote nothing",
    );
  });

  it("refuses a standard exercise's name in any case, naming it, and writes nothing", async () => {
    const user = await newUser();
    const input = reverseHyper({ name: "back squat" });
    const error = await rejectsWith(
      createExercise(db, user, input),
      "conflict",
    );
    assert.equal(error.message, '"Back Squat" already exists.');
    assert.equal(
      await rowCount("SELECT 1 FROM exercises WHERE id = $1", [input.id]),
      0,
    );
  });

  it("refuses a name a retired exercise of the user's still holds", async () => {
    const user = await newUser();
    const old = await createExercise(db, user, reverseHyper());
    await retireExercise(db, user, old.exercise.id);
    const error = await rejectsWith(
      createExercise(db, user, reverseHyper({ name: "REVERSE HYPER" })),
      "conflict",
    );
    assert.equal(error.message, '"Reverse Hyper" already exists.');
  });

  it("allows a name another user's custom exercise has", async () => {
    const other = await newUser();
    await createExercise(db, other, reverseHyper());
    const user = await newUser();
    await createExercise(db, user, reverseHyper());
  });

  it("treats an id that is another user's or a standard exercise's as a conflict, touching neither", async () => {
    const owner = await newUser();
    const theirs = reverseHyper();
    await createExercise(db, owner, theirs);
    const before = await xmins("exercise_metrics", "exercise_id", theirs.id);

    const intruder = await newUser();
    await rejectsWith(
      createExercise(
        db,
        intruder,
        reverseHyper({
          id: theirs.id,
          name: "Something Else",
          metrics: [{ metric: "DURATION", isRequired: true }],
        }),
      ),
      "conflict",
    );
    assert.deepEqual(
      await xmins("exercise_metrics", "exercise_id", theirs.id),
      before,
    );
    await rejectsWith(
      createExercise(
        db,
        intruder,
        reverseHyper({ id: BACK_SQUAT, name: "Mine Now" }),
      ),
      "conflict",
    );
    assert.equal(
      await rowCount("SELECT 1 FROM exercises WHERE owner_user_id = $1", [
        intruder,
      ]),
      0,
    );
  });
});

describe("editExercise", () => {
  it("renames the user's own exercise, and history shows the new name", async () => {
    const user = await newUser();
    const { exercise } = await createExercise(db, user, reverseHyper());
    const sessionId = await trainWith(user, exercise.id);

    const edited = await editExercise(db, user, exercise.id, {
      name: "Reverse Hyperextension",
    });
    assert.equal(edited.exercise.name, "Reverse Hyperextension");
    assert.deepEqual(edited.exercise.metrics, exercise.metrics);

    const detail = await getSession(db, user, sessionId);
    const logged = detail.exercises.find((e) => e.exerciseId === exercise.id);
    assert.equal(logged?.name, "Reverse Hyperextension");
  });

  it("changes muscles and equipment, judging the muscle rules on the merged row", async () => {
    const user = await newUser();
    const { exercise } = await createExercise(
      db,
      user,
      reverseHyper({ primaryMuscles: [], secondaryMuscles: [] }),
    );
    const error = await rejectsWith(
      editExercise(db, user, exercise.id, { secondaryMuscles: ["HAMSTRINGS"] }),
      "invalid",
    );
    assert.equal(
      error.message,
      "Choose a primary muscle before adding secondary muscles.",
    );

    await editExercise(db, user, exercise.id, { primaryMuscles: ["GLUTES"] });
    const both = await rejectsWith(
      editExercise(db, user, exercise.id, { secondaryMuscles: ["GLUTES"] }),
      "invalid",
    );
    assert.equal(
      both.message,
      "A muscle can't be both primary and secondary: glutes.",
    );

    const done = await editExercise(db, user, exercise.id, {
      secondaryMuscles: ["HAMSTRINGS"],
      equipment: null,
    });
    assert.deepEqual(done.exercise.primaryMuscles, ["GLUTES"]);
    assert.deepEqual(done.exercise.secondaryMuscles, ["HAMSTRINGS"]);
    assert.equal(done.exercise.equipment, null);
  });

  it("allows a case-only rename of its own name, refuses another exercise's", async () => {
    const user = await newUser();
    const { exercise } = await createExercise(db, user, reverseHyper());
    const renamed = await editExercise(db, user, exercise.id, {
      name: "reverse hyper",
    });
    assert.equal(renamed.exercise.name, "reverse hyper");
    const error = await rejectsWith(
      editExercise(db, user, exercise.id, { name: "Back squat" }),
      "conflict",
    );
    assert.equal(error.message, '"Back Squat" already exists.');
  });

  it("refuses to edit a standard exercise, leaving it unchanged", async () => {
    const user = await newUser();
    const before = await xmins("exercises", "id", BACK_SQUAT);
    const error = await rejectsWith(
      editExercise(db, user, BACK_SQUAT, { name: "My Squat" }),
      "invalid",
    );
    assert.equal(
      error.message,
      "Back Squat is a standard exercise and can't be edited.",
    );
    assert.deepEqual(await xmins("exercises", "id", BACK_SQUAT), before);
  });

  it("treats another user's exercise as not found", async () => {
    const owner = await newUser();
    const { exercise } = await createExercise(db, owner, reverseHyper());
    const intruder = await newUser();
    await rejectsWith(
      editExercise(db, intruder, exercise.id, { name: "Stolen" }),
      "not_found",
    );
    const { rows } = await pool.query(
      "SELECT name FROM exercises WHERE id = $1",
      [exercise.id],
    );
    assert.deepEqual(rows, [{ name: "Reverse Hyper" }]);
  });

  it("writes nothing when replayed", async () => {
    const user = await newUser();
    const { exercise } = await createExercise(db, user, reverseHyper());
    const input = {
      name: "Reverse Hyperextension",
      equipment: "CABLE" as const,
    };
    const first = await editExercise(db, user, exercise.id, input);
    const before = await xmins("exercises", "id", exercise.id);
    const second = await editExercise(db, user, exercise.id, input);
    assert.deepEqual(second, first);
    assert.deepEqual(await xmins("exercises", "id", exercise.id), before);
  });
});

describe("saveExerciseNotes", () => {
  it("records setup on a standard exercise that only this user sees", async () => {
    const user = await newUser();
    const other = await newUser();
    const saved = await saveExerciseNotes(db, user, BACK_SQUAT, {
      id: newId(),
      setup: "pins at 4",
      cues: "brace, then break",
    });
    assert.equal(saved.exercise.setup, "pins at 4");
    assert.equal(saved.exercise.cues, "brace, then break");

    const mine = (await list(user)).find((e) => e.id === BACK_SQUAT)!;
    assert.equal(mine.setup, "pins at 4");
    const theirs = (await list(other)).find((e) => e.id === BACK_SQUAT)!;
    assert.equal(theirs.setup, null);
    assert.equal(theirs.cues, null);
  });

  it("updates the existing row's setup and cues only, leaving the unit override and id", async () => {
    const user = await newUser();
    const rowId = newId();
    await pool.query(
      `INSERT INTO user_exercise_settings (id, user_id, exercise_id, default_weight_unit)
       VALUES ($1, $2, $3, 'KG')`,
      [rowId, user, BACK_SQUAT],
    );
    await saveExerciseNotes(db, user, BACK_SQUAT, {
      id: newId(),
      setup: "pins at 4",
      cues: null,
    });
    const { rows } = await pool.query(
      `SELECT id, setup, cues, default_weight_unit FROM user_exercise_settings
        WHERE user_id = $1`,
      [user],
    );
    assert.deepEqual(rows, [
      { id: rowId, setup: "pins at 4", cues: null, default_weight_unit: "KG" },
    ]);
  });

  it("writes nothing when replayed", async () => {
    const user = await newUser();
    const input = { id: newId(), setup: "pins at 4", cues: "chest up" };
    const first = await saveExerciseNotes(db, user, BACK_SQUAT, input);
    const before = await xmins("user_exercise_settings", "id", input.id);
    const second = await saveExerciseNotes(db, user, BACK_SQUAT, input);
    assert.deepEqual(second, first);
    assert.deepEqual(
      await xmins("user_exercise_settings", "id", input.id),
      before,
    );
    assert.equal(
      await rowCount(
        "SELECT 1 FROM user_exercise_settings WHERE user_id = $1",
        [user],
      ),
      1,
    );
  });

  it("refuses notes on an exercise the user can't see", async () => {
    const owner = await newUser();
    const { exercise } = await createExercise(db, owner, reverseHyper());
    const intruder = await newUser();
    await rejectsWith(
      saveExerciseNotes(db, intruder, exercise.id, {
        id: newId(),
        setup: "x",
        cues: null,
      }),
      "not_found",
    );
    assert.equal(
      await rowCount(
        "SELECT 1 FROM user_exercise_settings WHERE user_id = $1",
        [intruder],
      ),
      0,
    );
  });
});

describe("retireExercise and reactivateExercise", () => {
  it("retiring a used exercise hides it from the list, and history keeps its name", async () => {
    const user = await newUser();
    const { exercise } = await createExercise(db, user, reverseHyper());
    const sessionId = await trainWith(user, exercise.id);

    const retired = await retireExercise(db, user, exercise.id);
    assert.equal(retired.exercise.isActive, false);
    assert.ok(!(await list(user)).some((e) => e.id === exercise.id));
    const withRetired = await list(user, true);
    assert.equal(
      withRetired.find((e) => e.id === exercise.id)?.isActive,
      false,
    );
    assert.ok(
      withRetired.every((e) => e.isActive || e.isCustom),
      "includeRetired adds only the user's own retired exercises",
    );

    const detail = await getSession(db, user, sessionId);
    assert.equal(
      detail.exercises.find((e) => e.exerciseId === exercise.id)?.name,
      "Reverse Hyper",
    );
  });

  it("reactivating brings it back to the list", async () => {
    const user = await newUser();
    const { exercise } = await createExercise(db, user, reverseHyper());
    await retireExercise(db, user, exercise.id);
    const back = await reactivateExercise(db, user, exercise.id);
    assert.equal(back.exercise.isActive, true);
    assert.ok((await list(user)).some((e) => e.id === exercise.id));
  });

  it("writes nothing when replayed", async () => {
    const user = await newUser();
    const { exercise } = await createExercise(db, user, reverseHyper());
    const first = await retireExercise(db, user, exercise.id);
    const before = await xmins("exercises", "id", exercise.id);
    assert.deepEqual(await retireExercise(db, user, exercise.id), first);
    assert.deepEqual(await xmins("exercises", "id", exercise.id), before);
  });

  it("refuses a standard exercise and treats another user's as not found", async () => {
    const user = await newUser();
    const error = await rejectsWith(
      retireExercise(db, user, BACK_SQUAT),
      "invalid",
    );
    assert.equal(
      error.message,
      "Back Squat is a standard exercise and can't be retired.",
    );
    const owner = await newUser();
    const { exercise } = await createExercise(db, owner, reverseHyper());
    await rejectsWith(retireExercise(db, user, exercise.id), "not_found");
    await retireExercise(db, owner, exercise.id);
    await rejectsWith(reactivateExercise(db, user, exercise.id), "not_found");
    const { rows } = await pool.query(
      "SELECT is_active FROM exercises WHERE id = $1",
      [exercise.id],
    );
    assert.deepEqual(rows, [{ is_active: false }]);
  });
});
