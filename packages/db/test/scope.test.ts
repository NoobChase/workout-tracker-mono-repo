// The user-scoping primitives against a real database (spec step 2, decision
// 9; root CLAUDE.md requires a real Neon branch here, not mocks). Two users,
// each with a full plan tree, a private exercise and a settings row; every
// test asks user A's scope for user B's rows and expects nothing back. With no
// production call sites yet, this file is the call site.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  CrossTenantReferenceError,
  assertExercisesUsable,
  assertOwned,
  createDb,
  exercises,
  plannedExercises,
  plannedSets,
  userExerciseSettings,
  userScope,
  workoutPlans,
  workoutPrograms,
  workouts,
  type Db,
  type OwnedTable,
  type UserId,
} from "../src/index";
import { inRolledBackTransaction, pool } from "./db";

after(() => pool.end());

const STANDARD_EXERCISE = "01900000-0000-7000-8000-00000000c000";

/** Fixed UUIDv7-shaped ids per user; every test rolls back. */
function idsFor(n: 1 | 2) {
  const id = (k: number) =>
    `01900000-0000-7000-8000-0000000${n}${k.toString().padStart(4, "0")}`;
  return {
    user: id(0) as UserId,
    exercise: id(1),
    settings: id(2),
    program: id(3),
    plan: id(4),
    workout: id(5),
    plannedExercise: id(6),
    plannedSet: id(7),
  };
}
const A = idsFor(1);
const B = idsFor(2);

async function seed(db: Db, ids: ReturnType<typeof idsFor>, n: number) {
  await db.execute(
    `INSERT INTO users (id, clerk_user_id) VALUES ('${ids.user}', 'seed_scope_${n}')`,
  );
  await db.insert(exercises).values({
    id: ids.exercise,
    ownerUserId: ids.user,
    name: `Private lift ${n}`,
  });
  await db.insert(userExerciseSettings).values({
    id: ids.settings,
    userId: ids.user,
    exerciseId: STANDARD_EXERCISE,
    cues: "brace",
  });
  await db.insert(workoutPrograms).values({
    id: ids.program,
    userId: ids.user,
    name: "Program",
  });
  await db
    .insert(workoutPlans)
    .values({ id: ids.plan, programId: ids.program, cycleNumber: 1 });
  await db
    .insert(workouts)
    .values({ id: ids.workout, planId: ids.plan, name: "Day A", position: 0 });
  await db.insert(plannedExercises).values({
    id: ids.plannedExercise,
    workoutId: ids.workout,
    exerciseId: ids.exercise,
    position: 0,
  });
  await db.insert(plannedSets).values({
    id: ids.plannedSet,
    plannedExerciseId: ids.plannedExercise,
    setNumber: 1,
    targetRepsMin: 5,
  });
}

/** Runs `fn` against two seeded users inside a rolled-back transaction. */
function withTwoUsers(fn: (db: Db) => Promise<void>): Promise<void> {
  return inRolledBackTransaction(async (client) => {
    const db = createDb(client);
    await db.insert(exercises).values({
      id: STANDARD_EXERCISE,
      name: "Scope test squat",
    });
    await seed(db, A, 1);
    await seed(db, B, 2);
    await fn(db);
  });
}

const tables = {
  workoutPrograms: [workoutPrograms, "program"],
  workoutPlans: [workoutPlans, "plan"],
  workouts: [workouts, "workout"],
  plannedExercises: [plannedExercises, "plannedExercise"],
  plannedSets: [plannedSets, "plannedSet"],
  userExerciseSettings: [userExerciseSettings, "settings"],
} as const satisfies Record<OwnedTable, readonly [unknown, keyof typeof A]>;

describe("userScope", () => {
  it("user B's planned_set is unreachable through user A's scope", async () => {
    await withTwoUsers(async (db) => {
      const rows = await db
        .select()
        .from(plannedSets)
        .where(
          and(userScope(A.user).plannedSets, eq(plannedSets.id, B.plannedSet)),
        );
      assert.deepEqual(rows, []);
    });
  });

  for (const [name, [table, key]] of Object.entries(tables)) {
    it(`${name}: A's scope sees exactly A's row, never B's`, async () => {
      await withTwoUsers(async (db) => {
        const rows = await db
          .select({ id: table.id })
          .from(table)
          .where(
            and(
              userScope(A.user)[name as OwnedTable],
              inArray(table.id, [A[key], B[key]]),
            ),
          );
        assert.deepEqual(
          rows.map((r) => r.id),
          [A[key]],
        );
      });
    });
  }

  it("holds in UPDATE and DELETE: B's rows are untouched, A's are not", async () => {
    await withTwoUsers(async (db) => {
      const scope = userScope(A.user);
      const touch = (id: string) =>
        db
          .update(plannedSets)
          .set({ notes: "edited" })
          .where(and(scope.plannedSets, eq(plannedSets.id, id)))
          .returning({ id: plannedSets.id });

      assert.equal((await touch(B.plannedSet)).length, 0);
      assert.equal((await touch(A.plannedSet)).length, 1);

      const removed = await db
        .delete(workouts)
        .where(and(scope.workouts, eq(workouts.id, B.workout)))
        .returning({ id: workouts.id });
      assert.equal(removed.length, 0);

      const [survivor] = await db
        .select({ notes: plannedSets.notes })
        .from(plannedSets)
        .where(eq(plannedSets.id, B.plannedSet));
      assert.equal(survivor?.notes, null, "B's set exists and is unedited");
    });
  });

  it("exercises: visible is standard plus own; owned is own only", async () => {
    await withTwoUsers(async (db) => {
      const scope = userScope(A.user);
      const all = [STANDARD_EXERCISE, A.exercise, B.exercise];
      const ids = async (condition: typeof scope.visibleExercises) =>
        (
          await db
            .select({ id: exercises.id })
            .from(exercises)
            .where(and(condition, inArray(exercises.id, all)))
        )
          .map((r) => r.id)
          .sort();

      assert.deepEqual(
        await ids(scope.visibleExercises),
        [A.exercise, STANDARD_EXERCISE].sort(),
      );
      assert.deepEqual(await ids(scope.ownedExercises), [A.exercise]);
    });
  });
});

describe("assertOwned", () => {
  for (const [name, [, key]] of Object.entries(tables)) {
    it(`${name}: passes A's id, refuses B's`, async () => {
      await withTwoUsers(async (db) => {
        const table = name as OwnedTable;
        await assertOwned(db, A.user, table, [A[key]]);
        await assert.rejects(
          assertOwned(db, A.user, table, [B[key]]),
          CrossTenantReferenceError,
        );
      });
    });
  }

  it("names only the failing ids, and treats a missing id like a foreign one", async () => {
    await withTwoUsers(async (db) => {
      const missing = "01900000-0000-7000-8000-00000000dead";
      await assert.rejects(
        assertOwned(db, A.user, "workouts", [A.workout, B.workout, missing]),
        (err: CrossTenantReferenceError) => {
          assert.deepEqual([...err.ids].sort(), [B.workout, missing].sort());
          assert.equal(err.table, "workouts");
          return true;
        },
      );
    });
  });

  it("accepts an empty list and duplicates", async () => {
    await withTwoUsers(async (db) => {
      await assertOwned(db, A.user, "workouts", []);
      await assertOwned(db, A.user, "workouts", [A.workout, A.workout]);
    });
  });
});

describe("assertExercisesUsable", () => {
  it("allows standard and own exercises", async () => {
    await withTwoUsers(async (db) => {
      await assertExercisesUsable(db, A.user, [STANDARD_EXERCISE, A.exercise]);
    });
  });

  it("refuses another user's private exercise", async () => {
    // The invariant the schema leaves open (data-model.md 3.6): nothing stops
    // a planned exercise or a settings row pointing at B's private exercise.
    await withTwoUsers(async (db) => {
      await assert.rejects(
        assertExercisesUsable(db, A.user, [STANDARD_EXERCISE, B.exercise]),
        (err: CrossTenantReferenceError) => {
          assert.deepEqual(err.ids, [B.exercise]);
          return true;
        },
      );
    });
  });

  it("still allows a retired exercise the user may see", async () => {
    await withTwoUsers(async (db) => {
      await db
        .update(exercises)
        .set({ isActive: false })
        .where(eq(exercises.id, A.exercise));
      await assertExercisesUsable(db, A.user, [A.exercise]);
    });
  });
});
