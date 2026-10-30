// The clone primitive against a real database (operations.md 0.2; design D3).
// Root CLAUDE.md requires this on a Neon branch, not mocks. All three caller
// shapes:
//
//   1. a new cycle in the same program (3.1's N-1 clones, 3.12's extension)
//   2. cycle 1 into a new program (3.9)
//   3. an edited cycle over later cycles (3.8)
//
// Each checks that every level is copied, ids are fresh, positions and set
// numbers are preserved, and that a rerun with the same ids writes nothing.
// "Rerun" is a second transaction, so these commit for real: `seed_` clerk
// ids, rows removed in `after`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { v7 as uuidv7 } from "uuid";
import { and, eq } from "drizzle-orm";
import {
  CloneConflictError,
  CrossTenantReferenceError,
  clonePlan,
  createDb,
  exercises,
  plannedExercises,
  plannedSets,
  workoutPlans,
  workoutPrograms,
  workoutSessions,
  workouts,
  type ClonePlanInput,
  type CloneResult,
  type UserId,
} from "../src/index";
import { pool } from "./db";

const db = createDb(pool);
const userIds: string[] = [];

after(async () => {
  // Programs first: planned_exercises RESTRICT the user's private exercise,
  // so letting one users cascade race both would be order-dependent.
  await pool.query(
    "DELETE FROM workout_sessions WHERE user_id = ANY($1::uuid[])",
    [userIds],
  );
  await pool.query(
    "DELETE FROM workout_programs WHERE user_id = ANY($1::uuid[])",
    [userIds],
  );
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.end();
});

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Fixture {
  user: UserId;
  exercise: string;
  program: string;
  cycle1: string;
}

/** A user with one program whose cycle 1 exercises every cloned column. */
async function fixture(): Promise<Fixture> {
  const user = uuidv7() as UserId;
  userIds.push(user);
  const f: Fixture = {
    user,
    exercise: uuidv7(),
    program: uuidv7(),
    cycle1: uuidv7(),
  };
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO users (id, clerk_user_id) VALUES ('${user}', 'seed_clone_${randomUUID()}')`,
    );
    await tx
      .insert(exercises)
      .values({ id: f.exercise, ownerUserId: user, name: "Clone test press" });
    await tx
      .insert(workoutPrograms)
      .values({ id: f.program, userId: user, name: "Clone test" });
    await tx.insert(workoutPlans).values({
      id: f.cycle1,
      programId: f.program,
      cycleNumber: 1,
      name: "Base",
      notes: "cycle notes",
    });
    for (const [position, name] of ["Push", "Pull", "Legs"].entries()) {
      const workoutId = uuidv7();
      await tx.insert(workouts).values({
        id: workoutId,
        planId: f.cycle1,
        name,
        position,
        notes: position === 0 ? "Rest 2 min" : null,
      });
      const [top, slot, accessory] = [uuidv7(), uuidv7(), uuidv7()];
      await tx.insert(plannedExercises).values([
        {
          id: top,
          workoutId,
          exerciseId: f.exercise,
          position: 0,
          targetSets: 4,
          notes: "top set first",
        },
        {
          id: slot,
          workoutId,
          placeholderLabel: "Quads",
          position: 1,
          targetSets: 3,
          groupKey: 1,
        },
        // No planned sets: "do 3 sets".
        {
          id: accessory,
          workoutId,
          exerciseId: f.exercise,
          position: 2,
          targetSets: 3,
          groupKey: 1,
        },
      ]);
      await tx.insert(plannedSets).values([
        {
          id: uuidv7(),
          plannedExerciseId: top,
          setNumber: 1,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetWeight: "135",
          weightUnit: "LB",
          targetRpe: "8",
          notes: "go heavy",
        },
        {
          id: uuidv7(),
          plannedExerciseId: top,
          setNumber: 2,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetWeight: "70",
          weightUnit: "KG",
        },
        {
          id: uuidv7(),
          plannedExerciseId: slot,
          setNumber: 1,
          targetRepsMin: 10,
          targetRepsMax: 15,
          targetRir: "2.5",
        },
        {
          id: uuidv7(),
          plannedExerciseId: slot,
          setNumber: 2,
          targetDurationSeconds: 60,
          targetDistance: "1",
          distanceUnit: "MI",
        },
      ]);
    }
  });
  return f;
}

/**
 * A plan's subtree with every id stripped: what a clone must reproduce.
 * Ordered by the natural keys, so two equal trees compare equal.
 */
async function shape(planId: string) {
  const { rows } = await pool.query<{ tree: unknown }>(
    `SELECT coalesce(jsonb_agg(w ORDER BY w.position), '[]') AS tree FROM (
       SELECT w.name, w.position, w.notes,
         (SELECT coalesce(jsonb_agg(pe ORDER BY pe.position), '[]') FROM (
            SELECT pe.exercise_id, pe.placeholder_label, pe.position,
                   pe.target_sets, pe.group_key, pe.notes,
              (SELECT coalesce(jsonb_agg(ps ORDER BY ps.set_number), '[]') FROM (
                 SELECT ps.set_number, ps.target_reps_min, ps.target_reps_max,
                        ps.target_weight, ps.weight_unit, ps.target_weight_kg,
                        ps.target_duration_seconds, ps.target_distance,
                        ps.distance_unit, ps.target_rpe, ps.target_rir,
                        ps.notes
                 FROM planned_sets ps WHERE ps.planned_exercise_id = pe.id) ps
              ) AS sets
            FROM planned_exercises pe WHERE pe.workout_id = w.id) pe
         ) AS exercises
       FROM workouts w WHERE w.plan_id = $1) w`,
    [planId],
  );
  return rows[0]!.tree;
}

/** Every row id under a plan, by level. */
async function idsUnder(planId: string) {
  const { rows } = await pool.query<{ level: string; id: string }>(
    `SELECT 'w' AS level, w.id FROM workouts w WHERE w.plan_id = $1
     UNION ALL
     SELECT 'pe', pe.id FROM planned_exercises pe
       JOIN workouts w ON w.id = pe.workout_id WHERE w.plan_id = $1
     UNION ALL
     SELECT 'ps', ps.id FROM planned_sets ps
       JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
       JOIN workouts w ON w.id = pe.workout_id WHERE w.plan_id = $1`,
    [planId],
  );
  const by = (level: string) =>
    rows
      .filter((r) => r.level === level)
      .map((r) => r.id)
      .sort();
  return {
    workouts: by("w"),
    plannedExercises: by("pe"),
    plannedSets: by("ps"),
  };
}

/** (id, xmin) for every plan-tree row of a program: unchanged = not written. */
async function versions(programId: string) {
  const { rows } = await pool.query<{ id: string; xmin: string }>(
    `SELECT p.id, p.xmin::text FROM workout_plans p WHERE p.program_id = $1
     UNION ALL
     SELECT w.id, w.xmin::text FROM workouts w
       JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1
     UNION ALL
     SELECT pe.id, pe.xmin::text FROM planned_exercises pe
       JOIN workouts w ON w.id = pe.workout_id
       JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1
     UNION ALL
     SELECT ps.id, ps.xmin::text FROM planned_sets ps
       JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
       JOIN workouts w ON w.id = pe.workout_id
       JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1
     ORDER BY 1`,
    [programId],
  );
  return rows;
}

function clone(user: UserId, input: ClonePlanInput): Promise<CloneResult> {
  return db.transaction((tx) => clonePlan(tx, user, input));
}

/** The checks every caller shape shares. */
async function assertFaithfulClone(
  sourcePlanId: string,
  result: CloneResult,
): Promise<void> {
  // Every level copied: same names, positions, set numbers and targets.
  assert.deepEqual(await shape(result.planId), await shape(sourcePlanId));

  // Every source row mapped, every clone id fresh, UUIDv7, and exactly the
  // rows now under the target.
  const source = await idsUnder(sourcePlanId);
  const target = await idsUnder(result.planId);
  for (const level of [
    "workouts",
    "plannedExercises",
    "plannedSets",
  ] as const) {
    const map = result[level];
    assert.deepEqual(Object.keys(map).sort(), source[level], level);
    const fresh = Object.values(map);
    assert.deepEqual([...fresh].sort(), target[level], level);
    for (const id of fresh) {
      assert.match(id, UUID_V7);
      assert.ok(!source[level].includes(id), `${level}: reused ${id}`);
    }
  }
  assert.equal(target.workouts.length, 3);
  assert.equal(target.plannedExercises.length, 9);
  assert.equal(target.plannedSets.length, 12);
}

/** A rerun with the result's own ids: same answer, nothing written. */
async function assertRerunIsNoOp(
  user: UserId,
  programIds: string[],
  input: ClonePlanInput,
  result: CloneResult,
): Promise<void> {
  const before = await Promise.all(programIds.map(versions));
  const again = await clone(user, { ...input, ids: result });
  assert.deepEqual(again, result);
  assert.deepEqual(await Promise.all(programIds.map(versions)), before);
}

describe("clonePlan", () => {
  it("1. a new cycle in the same program (3.1, 3.12)", async () => {
    const f = await fixture();
    const input: ClonePlanInput = {
      sourcePlanId: f.cycle1,
      target: {
        programId: f.program,
        newPlanId: uuidv7(),
        cycleNumber: 2,
        name: "Base",
        notes: "cycle notes",
      },
    };
    const result = await clone(f.user, input);
    await assertFaithfulClone(f.cycle1, result);

    const plans = await db
      .select({
        cycleNumber: workoutPlans.cycleNumber,
        name: workoutPlans.name,
        notes: workoutPlans.notes,
      })
      .from(workoutPlans)
      .where(eq(workoutPlans.programId, f.program))
      .orderBy(workoutPlans.cycleNumber);
    assert.deepEqual(plans, [
      { cycleNumber: 1, name: "Base", notes: "cycle notes" },
      { cycleNumber: 2, name: "Base", notes: "cycle notes" },
    ]);

    // Both effort targets come across as written (design D16), not just
    // "the same as the source" -- which an all-NULL column also satisfies.
    // (Every fixture workout carries the same sets, hence DISTINCT.)
    const { rows: efforts } = await pool.query<{
      target_rpe: string | null;
      target_rir: string | null;
    }>(
      `SELECT DISTINCT ps.target_rpe, ps.target_rir FROM planned_sets ps
         JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
         JOIN workouts w ON w.id = pe.workout_id
       WHERE w.plan_id = $1
         AND (ps.target_rpe IS NOT NULL OR ps.target_rir IS NOT NULL)
       ORDER BY ps.target_rpe NULLS LAST`,
      [result.planId],
    );
    assert.deepEqual(efforts, [
      { target_rpe: "8.0", target_rir: null },
      { target_rpe: null, target_rir: "2.5" },
    ]);

    await assertRerunIsNoOp(f.user, [f.program], input, result);
  });

  it("2. cycle 1 into a new program (3.9)", async () => {
    const f = await fixture();
    const copy = uuidv7();
    // The caller writes the program row (and its suffixed name) itself.
    await db
      .insert(workoutPrograms)
      .values({ id: copy, userId: f.user, name: "Clone test (2)" });
    const input: ClonePlanInput = {
      sourcePlanId: f.cycle1,
      target: { programId: copy, newPlanId: uuidv7(), cycleNumber: 1 },
    };
    const result = await clone(f.user, input);
    await assertFaithfulClone(f.cycle1, result);

    const [plan] = await db
      .select()
      .from(workoutPlans)
      .where(eq(workoutPlans.programId, copy));
    assert.deepEqual(plan, {
      id: result.planId,
      programId: copy,
      cycleNumber: 1,
      name: null,
      notes: null,
    });
    // The source program is untouched: still one cycle.
    assert.equal((await versions(f.program)).length, 1 + 3 + 9 + 12);

    await assertRerunIsNoOp(f.user, [f.program, copy], input, result);
  });

  it("3. an edited cycle over later cycles (3.8)", async () => {
    const f = await fixture();
    // Cycles 2 and 3, inherited from cycle 1.
    const later: string[] = [];
    for (const cycleNumber of [2, 3]) {
      const r = await clone(f.user, {
        sourcePlanId: f.cycle1,
        target: { programId: f.program, newPlanId: uuidv7(), cycleNumber },
      });
      later.push(r.planId);
    }
    const inherited = await Promise.all(later.map(idsUnder));

    // Edit cycle 1: rename a workout, change a target, add a prescribed set,
    // drop the accessory from Legs.
    const [push, , legs] = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.planId, f.cycle1))
      .orderBy(workouts.position);
    await db
      .update(workouts)
      .set({ name: "Push (heavy)" })
      .where(eq(workouts.id, push!.id));
    const [top] = await db
      .update(plannedExercises)
      .set({ targetSets: 5 })
      .where(
        and(
          eq(plannedExercises.workoutId, push!.id),
          eq(plannedExercises.position, 0),
        ),
      )
      .returning({ id: plannedExercises.id });
    await db.insert(plannedSets).values({
      id: uuidv7(),
      plannedExerciseId: top!.id,
      setNumber: 3,
      targetRepsMin: 3,
      targetRepsMax: 5,
      targetWeight: "185",
      weightUnit: "LB",
    });
    await db
      .delete(plannedExercises)
      .where(
        and(
          eq(plannedExercises.workoutId, legs!.id),
          eq(plannedExercises.position, 2),
        ),
      );

    const edited = await shape(f.cycle1);
    const planRowsBefore = await db
      .select()
      .from(workoutPlans)
      .where(eq(workoutPlans.programId, f.program))
      .orderBy(workoutPlans.cycleNumber);

    // One transaction for both, as the 3.8 flow runs it.
    const inputs: ClonePlanInput[] = later.map((existingPlanId) => ({
      sourcePlanId: f.cycle1,
      target: { existingPlanId },
    }));
    const results = await db.transaction(async (tx) => {
      const out: CloneResult[] = [];
      for (const input of inputs) out.push(await clonePlan(tx, f.user, input));
      return out;
    });

    for (const [i, result] of results.entries()) {
      assert.equal(result.planId, later[i]);
      assert.deepEqual(await shape(result.planId), edited);
      const now = await idsUnder(result.planId);
      assert.deepEqual(
        [...now.workouts].sort(),
        Object.values(result.workouts).sort(),
      );
      assert.equal(now.plannedExercises.length, 8);
      assert.equal(now.plannedSets.length, 13);
      // The inherited rows are gone, not left beside the clone.
      for (const level of [
        "workouts",
        "plannedExercises",
        "plannedSets",
      ] as const) {
        for (const old of inherited[i]![level]) {
          assert.ok(!now[level].includes(old), `${level}: ${old} survived`);
        }
      }
    }
    // The plan rows themselves -- ids, cycle numbers, names -- are kept.
    assert.deepEqual(
      await db
        .select()
        .from(workoutPlans)
        .where(eq(workoutPlans.programId, f.program))
        .orderBy(workoutPlans.cycleNumber),
      planRowsBefore,
    );

    for (const [i, input] of inputs.entries()) {
      await assertRerunIsNoOp(f.user, [f.program], input, results[i]!);
    }
  });

  it("refuses another user's source, program or plan, writing nothing", async () => {
    const a = await fixture();
    const b = await fixture();
    const before = await Promise.all([a.program, b.program].map(versions));

    const refused = (user: UserId, input: ClonePlanInput) =>
      assert.rejects(clone(user, input), CrossTenantReferenceError);
    // A clones B's cycle into A's program.
    await refused(a.user, {
      sourcePlanId: b.cycle1,
      target: { programId: a.program, newPlanId: uuidv7(), cycleNumber: 2 },
    });
    // A clones A's cycle into B's program.
    await refused(a.user, {
      sourcePlanId: a.cycle1,
      target: { programId: b.program, newPlanId: uuidv7(), cycleNumber: 2 },
    });
    // A clones A's cycle over B's.
    await refused(a.user, {
      sourcePlanId: a.cycle1,
      target: { existingPlanId: b.cycle1 },
    });

    assert.deepEqual(
      await Promise.all([a.program, b.program].map(versions)),
      before,
    );
  });

  it("refuses ids that already belong elsewhere, and rolls back whole", async () => {
    const a = await fixture();
    const b = await fixture();
    const before = await Promise.all([a.program, b.program].map(versions));

    // newPlanId is B's cycle 1: DO NOTHING would otherwise hang A's clone
    // under B's plan.
    await assert.rejects(
      clone(a.user, {
        sourcePlanId: a.cycle1,
        target: { programId: a.program, newPlanId: b.cycle1, cycleNumber: 2 },
      }),
      CloneConflictError,
    );
    // newPlanId is A's own cycle 1, under another cycle number.
    await assert.rejects(
      clone(a.user, {
        sourcePlanId: a.cycle1,
        target: { programId: a.program, newPlanId: a.cycle1, cycleNumber: 2 },
      }),
      CloneConflictError,
    );
    // A forged id map naming the source's own workouts.
    const sourceWorkouts = (await idsUnder(a.cycle1)).workouts;
    await assert.rejects(
      clone(a.user, {
        sourcePlanId: a.cycle1,
        target: { programId: a.program, newPlanId: uuidv7(), cycleNumber: 2 },
        ids: {
          workouts: Object.fromEntries(sourceWorkouts.map((id) => [id, id])),
        },
      }),
      CloneConflictError,
    );
    await assert.rejects(
      clone(a.user, {
        sourcePlanId: a.cycle1,
        target: { existingPlanId: a.cycle1 },
      }),
      /cannot be cloned over itself/,
    );

    assert.deepEqual(
      await Promise.all([a.program, b.program].map(versions)),
      before,
    );
  });

  it("will not replace a trained cycle: RESTRICT stops it, and nothing changes", async () => {
    const f = await fixture();
    const cycle2 = await clone(f.user, {
      sourcePlanId: f.cycle1,
      target: { programId: f.program, newPlanId: uuidv7(), cycleNumber: 2 },
    });
    const trained = Object.values(cycle2.workouts)[0]!;
    await db
      .insert(workoutSessions)
      .values({ id: uuidv7(), userId: f.user, workoutId: trained });
    const before = await versions(f.program);

    await assert.rejects(
      clone(f.user, {
        sourcePlanId: f.cycle1,
        target: { existingPlanId: cycle2.planId },
      }),
      (err: { code?: string; cause?: { code?: string } }) => {
        // restrict_violation, possibly wrapped by drizzle's query error.
        assert.equal(err.cause?.code ?? err.code, "23001");
        return true;
      },
    );
    assert.deepEqual(await versions(f.program), before);
  });
});
