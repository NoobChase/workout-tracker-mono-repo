// Integration tests for the constructs the schema leans on as database
// guarantees (data-model.md 7, entry 1) -- above all the two DEFERRABLE
// position uniques, which live in a --custom migration that drizzle-kit's
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

describe("position uniques", () => {
  for (const name of [
    "workouts_plan_id_position_key",
    "planned_exercises_workout_id_position_key",
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

  it("a user has at most one ACTIVE program", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        "INSERT INTO users (id, clerk_user_id) VALUES ($1, 'seed_test')",
        [USER],
      );
      const insert =
        "INSERT INTO workout_programs (id, user_id, name, status) VALUES ($1, $2, $3, $4)";
      await client.query(insert, [PROGRAM, USER, "One", "ACTIVE"]);
      await client.query(insert, [
        "01900000-0000-7000-8000-0000000000c1",
        USER,
        "Two",
        "DRAFT",
      ]);
      await assertRejects(
        client,
        insert,
        ["01900000-0000-7000-8000-0000000000c2", USER, "Three", "ACTIVE"],
        UNIQUE_VIOLATION,
      );
    });
  });
});
