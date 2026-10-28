// The shared "a set that counts" predicate (data-model.md 2.8), against a real
// database: the worked example's Barbell Row (worked-example.md 2.3) -- a
// warm-up and four working sets -- plus a drop set hanging off the last one.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { and, count, eq } from "drizzle-orm";
import {
  countsAsSet,
  createDb,
  exercises,
  sessionExercises,
  sessionSets,
  userScope,
  workoutSessions,
  type UserId,
} from "../src/index";
import { inRolledBackTransaction, pool } from "./db";

after(() => pool.end());

const USER = "01900000-0000-7000-8000-00000000f001" as UserId;
const EXERCISE = "01900000-0000-7000-8000-00000000f002";
const SESSION = "01900000-0000-7000-8000-00000000f003";
const SESSION_EXERCISE = "01900000-0000-7000-8000-00000000f004";
const set = (n: number) => `01900000-0000-7000-8000-00000000f1${n}0`;

describe("countsAsSet", () => {
  it("excludes warm-ups and drop children; a drop set counts as its parent", async () => {
    await inRolledBackTransaction(async (client) => {
      const db = createDb(client);
      await db.execute(
        `INSERT INTO users (id, clerk_user_id) VALUES ('${USER}', 'seed_predicates')`,
      );
      await db
        .insert(exercises)
        .values({ id: EXERCISE, name: "Predicate test row" });
      await db.insert(workoutSessions).values({ id: SESSION, userId: USER });
      await db.insert(sessionExercises).values({
        id: SESSION_EXERCISE,
        sessionId: SESSION,
        exerciseId: EXERCISE,
        position: 0,
      });
      const row = (
        n: number,
        reps: number,
        weight: string,
        kind: "NORMAL" | "WARMUP" | "DROP" = "NORMAL",
        parentSetId: string | null = null,
      ) => ({
        id: set(n),
        sessionExerciseId: SESSION_EXERCISE,
        setNumber: n,
        reps,
        weight,
        weightUnit: "LB" as const,
        kind,
        parentSetId,
      });
      await db
        .insert(sessionSets)
        .values([
          row(1, 10, "95", "WARMUP"),
          row(2, 12, "135"),
          row(3, 10, "135"),
          row(4, 8, "155"),
          row(5, 6, "155"),
          row(6, 4, "115", "DROP", set(5)),
        ]);

      const scope = userScope(USER);
      const [all] = await db
        .select({ n: count() })
        .from(sessionSets)
        .where(scope.sessionSets);
      const [counted] = await db
        .select({ n: count() })
        .from(sessionSets)
        .where(and(scope.sessionSets, countsAsSet));
      assert.equal(all?.n, 6);
      assert.equal(counted?.n, 4, "four working sets; the drop is set 5's");

      // Composes inside a join, as history and progression queries use it.
      const [joined] = await db
        .select({ n: count() })
        .from(sessionSets)
        .innerJoin(
          sessionExercises,
          eq(sessionExercises.id, sessionSets.sessionExerciseId),
        )
        .where(
          and(
            scope.sessionSets,
            countsAsSet,
            eq(sessionExercises.exerciseId, EXERCISE),
          ),
        );
      assert.equal(joined?.n, 4);
    });
  });
});
