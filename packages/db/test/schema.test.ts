// Integration tests for the constructs the schema leans on as database
// guarantees (data-model.md 7, entry 1) -- above all the four DEFERRABLE
// uniques, which live in --custom migrations (0001, 0005) that drizzle-kit's
// differ cannot see. If a regeneration drops the clause, this file is what
// notices. (spec step 2, decision 7.)
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { PoolClient } from "@neondatabase/serverless";
import { inRolledBackTransaction, pool } from "./db";

after(() => pool.end());

// Fixed UUIDv7-shaped literals; every test rolls back, so they never collide.
const USER = "01900000-0000-7000-8000-000000000001";
const PROGRAM = "01900000-0000-7000-8000-000000000002";
const PLAN = "01900000-0000-7000-8000-000000000003";
const WORKOUT_A = "01900000-0000-7000-8000-000000000004";
const WORKOUT_B = "01900000-0000-7000-8000-000000000005";
const EXERCISE = "01900000-0000-7000-8000-000000000006";
const PLANNED_EXERCISE = "01900000-0000-7000-8000-000000000007";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INVALID_TEXT_REPRESENTATION = "22P02";

/** Asserts `sql` fails with `code`, leaving the transaction usable. */
async function assertRejects(
  client: PoolClient,
  sql: string,
  params: unknown[],
  code: string,
): Promise<void> {
  await client.query("SAVEPOINT expect_error");
  await assert.rejects(client.query(sql, params), (err: { code?: string }) => {
    assert.equal(err.code, code);
    return true;
  });
  await client.query("ROLLBACK TO SAVEPOINT expect_error");
}

async function seedPlan(client: PoolClient): Promise<void> {
  await client.query(
    "INSERT INTO users (id, clerk_user_id) VALUES ($1, 'seed_test')",
    [USER],
  );
  await client.query(
    "INSERT INTO workout_programs (id, user_id, name) VALUES ($1, $2, 'P')",
    [PROGRAM, USER],
  );
  await client.query(
    "INSERT INTO workout_plans (id, program_id, cycle_number) VALUES ($1, $2, 1)",
    [PLAN, PROGRAM],
  );
}

describe("deferrable uniques", () => {
  for (const name of [
    "workouts_plan_id_position_key",
    "planned_exercises_workout_id_position_key",
    "session_exercises_session_id_position_key",
    "session_sets_session_exercise_id_set_number_key",
  ]) {
    it(`${name} is DEFERRABLE INITIALLY DEFERRED`, async () => {
      const { rows } = await pool.query<{
        condeferrable: boolean;
        condeferred: boolean;
      }>(
        "SELECT condeferrable, condeferred FROM pg_constraint WHERE conname = $1",
        [name],
      );
      assert.deepEqual(rows, [{ condeferrable: true, condeferred: true }]);
    });
  }

  it("two workouts can swap positions in one statement", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedPlan(client);
      await client.query(
        "INSERT INTO workouts (id, plan_id, name, position) VALUES ($1, $3, 'A', 0), ($2, $3, 'B', 1)",
        [WORKOUT_A, WORKOUT_B, PLAN],
      );
      await client.query(
        "UPDATE workouts SET position = 1 - position WHERE plan_id = $1",
        [PLAN],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });

  // The control for the test above: proves the forced check really runs, so
  // the swap passing means something.
  it("a real duplicate position is still rejected", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedPlan(client);
      await client.query(
        "INSERT INTO workouts (id, plan_id, name, position) VALUES ($1, $3, 'A', 0), ($2, $3, 'B', 0)",
        [WORKOUT_A, WORKOUT_B, PLAN],
      );
      await assertRejects(
        client,
        "SET CONSTRAINTS ALL IMMEDIATE",
        [],
        UNIQUE_VIOLATION,
      );
    });
  });
});

describe("planned_sets.target_weight_kg", () => {
  it("converts each unit, with no fallback for a missing one", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedPlan(client);
      await client.query(
        "INSERT INTO workouts (id, plan_id, name, position) VALUES ($1, $2, 'A', 0)",
        [WORKOUT_A, PLAN],
      );
      await client.query(
        "INSERT INTO planned_exercises (id, workout_id, placeholder_label, position) VALUES ($1, $2, 'Quads', 0)",
        [PLANNED_EXERCISE, WORKOUT_A],
      );
      const { rows } = await client.query<{
        weight_unit: string | null;
        target_weight_kg: string | null;
      }>(
        `INSERT INTO planned_sets (id, planned_exercise_id, set_number, target_weight, weight_unit) VALUES
           ('01900000-0000-7000-8000-0000000000a1', $1, 1, 100, 'LB'),
           ('01900000-0000-7000-8000-0000000000a2', $1, 2, 100, 'KG'),
           ('01900000-0000-7000-8000-0000000000a3', $1, 3, NULL, NULL)
         RETURNING weight_unit, target_weight_kg`,
        [PLANNED_EXERCISE],
      );
      assert.deepEqual(rows, [
        { weight_unit: "LB", target_weight_kg: "45.3592" },
        { weight_unit: "KG", target_weight_kg: "100.0000" },
        { weight_unit: null, target_weight_kg: null },
      ]);

      // The unit CHECK is what stops a weight vanishing from aggregates.
      await assertRejects(
        client,
        "INSERT INTO planned_sets (id, planned_exercise_id, set_number, target_weight) VALUES ('01900000-0000-7000-8000-0000000000a4', $1, 4, 100)",
        [PLANNED_EXERCISE],
        CHECK_VIOLATION,
      );
    });
  });
});

describe("planned_exercises exercise-or-placeholder", () => {
  it("requires exactly one of exercise_id and placeholder_label", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedPlan(client);
      await client.query(
        "INSERT INTO workouts (id, plan_id, name, position) VALUES ($1, $2, 'A', 0)",
        [WORKOUT_A, PLAN],
      );
      await client.query(
        "INSERT INTO exercises (id, name) VALUES ($1, 'Test Squat')",
        [EXERCISE],
      );
      const insert =
        "INSERT INTO planned_exercises (id, workout_id, exercise_id, placeholder_label, position) VALUES ($1, $2, $3, $4, 0)";

      await assertRejects(
        client,
        insert,
        [PLANNED_EXERCISE, WORKOUT_A, null, null],
        CHECK_VIOLATION,
      );
      await assertRejects(
        client,
        insert,
        [PLANNED_EXERCISE, WORKOUT_A, EXERCISE, "Quads"],
        CHECK_VIOLATION,
      );
      await client.query(insert, [PLANNED_EXERCISE, WORKOUT_A, EXERCISE, null]);
    });
  });
});

describe("partial unique indexes", () => {
  it("standard exercise names are unique ignoring case; user names only per user", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        "INSERT INTO users (id, clerk_user_id) VALUES ($1, 'seed_test')",
        [USER],
      );
      await client.query(
        "INSERT INTO exercises (id, name) VALUES ($1, 'Test Squat')",
        [EXERCISE],
      );

      await assertRejects(
        client,
        "INSERT INTO exercises (id, name) VALUES ('01900000-0000-7000-8000-0000000000b1', 'test squat')",
        [],
        UNIQUE_VIOLATION,
      );
      // A user may shadow a standard name with their own exercise...
      await client.query(
        "INSERT INTO exercises (id, owner_user_id, name) VALUES ('01900000-0000-7000-8000-0000000000b2', $1, 'Test Squat')",
        [USER],
      );
      // ...but not twice.
      await assertRejects(
        client,
        "INSERT INTO exercises (id, owner_user_id, name) VALUES ('01900000-0000-7000-8000-0000000000b3', $1, 'TEST SQUAT')",
        [USER],
        UNIQUE_VIOLATION,
      );
    });
  });

  it("a user may have several ACTIVE programs at once", async () => {
    // one_active_program_per_user was dropped (migration 0002): a lifting
    // block can run alongside a running block (data-model.md 7).
    await inRolledBackTransaction(async (client) => {
      await client.query(
        "INSERT INTO users (id, clerk_user_id) VALUES ($1, 'seed_test')",
        [USER],
      );
      const insert =
        "INSERT INTO workout_programs (id, user_id, name, status) VALUES ($1, $2, $3, 'ACTIVE')";
      await client.query(insert, [PROGRAM, USER, "Lifting"]);
      await client.query(insert, [
        "01900000-0000-7000-8000-0000000000c1",
        USER,
        "Running",
      ]);
      const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM workout_programs WHERE user_id = $1 AND status = 'ACTIVE'",
        [USER],
      );
      assert.equal(rows[0]!.n, 2);
    });
  });
});

describe("exercise muscles and equipment", () => {
  const insert =
    "INSERT INTO exercises (id, name, primary_muscles, secondary_muscles, equipment) VALUES ($1, $2, $3::muscle_group[], $4::muscle_group[], $5)";
  const id = (n: number) => `01900000-0000-7000-8000-0000000000e${n}`;

  it("allows none, primary only, or primary with secondary", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(insert, [id(1), "Blank", "{}", "{}", null]);
      await client.query(insert, [id(2), "Curl", "{BICEPS}", "{}", "DUMBBELL"]);
      await client.query(insert, [
        id(3),
        "Squat",
        "{QUADS,GLUTES}",
        "{ADDUCTORS,LOWER_BACK}",
        "BARBELL",
      ]);
      const { rows } = await client.query<{ primary_muscles: string }>(
        "SELECT primary_muscles::text FROM exercises WHERE id = $1",
        [id(3)],
      );
      assert.equal(rows[0]!.primary_muscles, "{QUADS,GLUTES}");
    });
  });

  it("refuses secondary muscles without a primary", async () => {
    await inRolledBackTransaction(async (client) => {
      await assertRejects(
        client,
        insert,
        [id(4), "Orphan", "{}", "{TRICEPS}", null],
        CHECK_VIOLATION,
      );
    });
  });

  it("refuses a muscle listed as both primary and secondary", async () => {
    await inRolledBackTransaction(async (client) => {
      await assertRejects(
        client,
        insert,
        [id(5), "Both", "{CHEST}", "{CHEST,TRICEPS}", "BARBELL"],
        CHECK_VIOLATION,
      );
    });
  });

  it("refuses values outside the fixed lists", async () => {
    await inRolledBackTransaction(async (client) => {
      await assertRejects(
        client,
        insert,
        [id(6), "Typo muscle", "{QUADZ}", "{}", null],
        INVALID_TEXT_REPRESENTATION,
      );
      await assertRejects(
        client,
        insert,
        [id(7), "Typo kit", "{}", "{}", "rock"],
        INVALID_TEXT_REPRESENTATION,
      );
    });
  });
});

describe("session tables", () => {
  const SESSION = "01900000-0000-7000-8000-0000000000f1";
  const SESSION_EXERCISE = "01900000-0000-7000-8000-0000000000f2";
  const set = (n: number) =>
    `01900000-0000-7000-8000-0000000001${n.toString().padStart(2, "0")}`;

  async function seedSessionExercise(client: PoolClient): Promise<void> {
    await seedPlan(client);
    await client.query(
      "INSERT INTO exercises (id, name) VALUES ($1, 'Test Squat')",
      [EXERCISE],
    );
    await client.query(
      "INSERT INTO workout_sessions (id, user_id) VALUES ($1, $2)",
      [SESSION, USER],
    );
    await client.query(
      "INSERT INTO session_exercises (id, session_id, exercise_id, position) VALUES ($1, $2, $3, 0)",
      [SESSION_EXERCISE, SESSION, EXERCISE],
    );
  }

  it("a session defaults to IN_PROGRESS and allows no workout (ad-hoc)", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedSessionExercise(client);
      const { rows } = await client.query<{
        status: string;
        workout_id: string | null;
      }>("SELECT status, workout_id FROM workout_sessions WHERE id = $1", [
        SESSION,
      ]);
      assert.deepEqual(rows, [{ status: "IN_PROGRESS", workout_id: null }]);
    });
  });

  it("every generated unit column names each enum value and has no ELSE", async () => {
    // data-model.md 2.5: a unit added to the enum without updating these goes
    // visibly NULL. Read the generation expressions the database holds, and
    // the enum values from the database too, so a new value fails here.
    const { rows } = await pool.query<{ col: string; expr: string }>(
      `SELECT a.attrelid::regclass || '.' || a.attname AS col,
              pg_get_expr(d.adbin, d.adrelid) AS expr
         FROM pg_attribute a
         JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attgenerated = 's'
          AND a.attrelid IN ('planned_sets'::regclass, 'session_sets'::regclass)
        ORDER BY 1`,
    );
    assert.deepEqual(
      rows.map((r) => r.col),
      [
        "planned_sets.target_weight_kg",
        "session_sets.distance_m",
        "session_sets.weight_kg",
      ],
    );
    const enumValues = async (type: string) =>
      (
        await pool.query<{ v: string }>(
          "SELECT unnest(enum_range(NULL::" + type + "))::text AS v",
        )
      ).rows.map((r) => r.v);
    const weight = await enumValues("weight_unit");
    const distance = await enumValues("distance_unit");
    for (const { col, expr } of rows) {
      // Postgres deparses an absent ELSE as `ELSE NULL::numeric`; any other
      // ELSE is a catch-all that would convert an unknown unit silently.
      assert.doesNotMatch(expr, /\bELSE\b(?!\s+NULL::numeric\b)/i, col);
      for (const unit of col.endsWith("distance_m") ? distance : weight) {
        assert.match(expr, new RegExp(`'${unit}'`), `${col}: ${unit}`);
      }
    }
  });

  it("converts each unit, and refuses a weight or distance without one", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedSessionExercise(client);
      const { rows } = await client.query<{
        weight_kg: string | null;
        distance_m: string | null;
      }>(
        `INSERT INTO session_sets (id, session_exercise_id, set_number, reps, weight, weight_unit, distance, distance_unit) VALUES
           ($2, $1, 1, 5, 135, 'LB', NULL, NULL),
           ($3, $1, 2, 5, 100, 'KG', NULL, NULL),
           ($4, $1, 3, 5, NULL, NULL, 1, 'MI'),
           ($5, $1, 4, 5, NULL, NULL, 100, 'FT')
         RETURNING weight_kg, distance_m`,
        [SESSION_EXERCISE, set(1), set(2), set(3), set(4)],
      );
      assert.deepEqual(rows, [
        { weight_kg: "61.2350", distance_m: null },
        { weight_kg: "100.0000", distance_m: null },
        { weight_kg: null, distance_m: "1609.3440" },
        { weight_kg: null, distance_m: "30.4800" },
      ]);

      await assertRejects(
        client,
        "INSERT INTO session_sets (id, session_exercise_id, set_number, reps, weight) VALUES ($1, $2, 5, 5, 100)",
        [set(5), SESSION_EXERCISE],
        CHECK_VIOLATION,
      );
      await assertRejects(
        client,
        "INSERT INTO session_sets (id, session_exercise_id, set_number, distance) VALUES ($1, $2, 5, 100)",
        [set(5), SESSION_EXERCISE],
        CHECK_VIOLATION,
      );
    });
  });

  it("a set must record something: num_nonnulls(reps, weight, duration, distance, completed) > 0", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedSessionExercise(client);
      const insert =
        "INSERT INTO session_sets (id, session_exercise_id, set_number, reps, completed, rpe) VALUES ($1, $2, $3, $4, $5, $6)";
      // Nothing at all, or only an RPE, is not a set.
      await assertRejects(
        client,
        insert,
        [set(1), SESSION_EXERCISE, 1, null, null, null],
        CHECK_VIOLATION,
      );
      await assertRejects(
        client,
        insert,
        [set(1), SESSION_EXERCISE, 1, null, null, 8],
        CHECK_VIOLATION,
      );
      // Zero reps and an unticked box are values, not absences.
      await client.query(insert, [set(1), SESSION_EXERCISE, 1, 0, null, null]);
      await client.query(insert, [
        set(2),
        SESSION_EXERCISE,
        2,
        null,
        false,
        null,
      ]);
    });
  });

  it("deleting a middle set and renumbering the survivors passes the deferred unique", async () => {
    // data-model.md 8.2: the renumber is the reason the unique is deferrable.
    await inRolledBackTransaction(async (client) => {
      await seedSessionExercise(client);
      for (let n = 1; n <= 4; n++) {
        await client.query(
          "INSERT INTO session_sets (id, session_exercise_id, set_number, reps) VALUES ($1, $2, $3, $3)",
          [set(n), SESSION_EXERCISE, n],
        );
      }
      await client.query("DELETE FROM session_sets WHERE id = $1", [set(2)]);
      await client.query(
        "UPDATE session_sets SET set_number = set_number - 1 WHERE session_exercise_id = $1 AND set_number > 2",
        [SESSION_EXERCISE],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const { rows } = await client.query<{ set_number: number; reps: number }>(
        "SELECT set_number, reps FROM session_sets WHERE session_exercise_id = $1 ORDER BY set_number",
        [SESSION_EXERCISE],
      );
      assert.deepEqual(rows, [
        { set_number: 1, reps: 1 },
        { set_number: 2, reps: 3 },
        { set_number: 3, reps: 4 },
      ]);
    });
  });

  it("a real duplicate set number is still rejected", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedSessionExercise(client);
      await client.query(
        "INSERT INTO session_sets (id, session_exercise_id, set_number, reps) VALUES ($1, $3, 1, 5), ($2, $3, 1, 5)",
        [set(1), set(2), SESSION_EXERCISE],
      );
      await assertRejects(
        client,
        "SET CONSTRAINTS ALL IMMEDIATE",
        [],
        UNIQUE_VIOLATION,
      );
    });
  });

  it("deleting a working set takes its drop-set children with it", async () => {
    await inRolledBackTransaction(async (client) => {
      await seedSessionExercise(client);
      await client.query(
        `INSERT INTO session_sets (id, session_exercise_id, set_number, reps, kind, parent_set_id) VALUES
           ($1, $3, 1, 8, 'NORMAL', NULL),
           ($2, $3, 2, 6, 'DROP', $1)`,
        [set(1), set(2), SESSION_EXERCISE],
      );
      await client.query("DELETE FROM session_sets WHERE id = $1", [set(1)]);
      const { rows } = await client.query(
        "SELECT 1 FROM session_sets WHERE session_exercise_id = $1",
        [SESSION_EXERCISE],
      );
      assert.equal(rows.length, 0);
    });
  });
});
