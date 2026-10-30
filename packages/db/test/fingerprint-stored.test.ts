// The cycle fingerprint over stored cycles, on a real Neon branch (design D6).
// The normalizer is shared, so the point here is the read side: a cycle
// written through real inserts must fingerprint exactly like the tree it was
// written from -- Drizzle's "135.50" against the request's 135.5 included --
// and a clonePlan copy exactly like its source. Every test rolls back.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  CrossTenantReferenceError,
  clonePlan,
  createDb,
  cycleFingerprint,
  exercises,
  plannedExercises,
  plannedSets,
  readCycleTrees,
  storedCycleFingerprint,
  storedCycleFingerprints,
  workoutPlans,
  workoutPrograms,
  workouts,
  type FingerprintInput,
  type Db,
  type UserId,
} from "../src/index";
import { inRolledBackTransaction, pool } from "./db";

after(() => pool.end());

interface World {
  db: Db;
  user: UserId;
  other: UserId;
  program: string;
  cycle1: string;
  tree: FingerprintInput;
}

/**
 * A request-shaped tree with client-minted ids: a private exercise, a
 * standard one, a placeholder, a superset with an odd group key, numerics as
 * JS numbers, and notes at every level.
 */
function requestTree(
  privateExercise: string,
  standardExercise: string,
): FingerprintInput {
  return {
    id: uuidv7(),
    name: "Base",
    notes: "cycle notes",
    workouts: [
      {
        id: uuidv7(),
        name: "Push",
        position: 0,
        notes: "Rest 2 min",
        plannedExercises: [
          {
            id: uuidv7(),
            exerciseId: privateExercise,
            position: 0,
            targetSets: 4,
            groupKey: 7,
            notes: "top set first",
            plannedSets: [
              {
                id: uuidv7(),
                setNumber: 1,
                targetRepsMin: 8,
                targetRepsMax: 12,
                targetWeight: 135.5,
                weightUnit: "LB",
                targetRpe: 8,
                notes: "go heavy",
              },
              {
                id: uuidv7(),
                setNumber: 2,
                targetRepsMin: 6,
                targetRepsMax: 6,
                targetWeight: "70",
                weightUnit: "KG",
                targetRir: 2,
              },
            ],
          },
          {
            id: uuidv7(),
            exerciseId: standardExercise,
            position: 1,
            targetSets: 3,
            groupKey: 7,
            plannedSets: [],
          },
          {
            id: uuidv7(),
            placeholderLabel: "Quads",
            position: 2,
            targetSets: 3,
            plannedSets: [
              {
                id: uuidv7(),
                setNumber: 1,
                targetDurationSeconds: 60,
                targetDistance: 1.25,
                distanceUnit: "MI",
              },
            ],
          },
        ],
      },
      { id: uuidv7(), name: "Rest day", position: 1, plannedExercises: [] },
    ],
  };
}

/** Writes `tree` as cycle `cycleNumber` of `program`, level by level. */
async function insertTree(
  db: Db,
  program: string,
  cycleNumber: number,
  tree: FingerprintInput,
): Promise<void> {
  const dec = (v: string | number | null | undefined) =>
    v === null || v === undefined ? null : String(v);
  await db.insert(workoutPlans).values({
    id: tree.id!,
    programId: program,
    cycleNumber,
    name: tree.name ?? null,
    notes: tree.notes ?? null,
  });
  for (const w of tree.workouts) {
    await db.insert(workouts).values({
      id: w.id!,
      planId: tree.id!,
      name: w.name,
      position: w.position,
      notes: w.notes ?? null,
    });
    for (const pe of w.plannedExercises) {
      await db.insert(plannedExercises).values({
        id: pe.id!,
        workoutId: w.id!,
        exerciseId: pe.exerciseId ?? null,
        placeholderLabel: pe.placeholderLabel ?? null,
        position: pe.position,
        targetSets: pe.targetSets!,
        groupKey: pe.groupKey ?? null,
        notes: pe.notes ?? null,
      });
      for (const s of pe.plannedSets) {
        await db.insert(plannedSets).values({
          id: s.id!,
          plannedExerciseId: pe.id!,
          setNumber: s.setNumber,
          targetRepsMin: s.targetRepsMin ?? null,
          targetRepsMax: s.targetRepsMax ?? null,
          targetWeight: dec(s.targetWeight),
          weightUnit: s.weightUnit ?? null,
          targetDurationSeconds: s.targetDurationSeconds ?? null,
          targetDistance: dec(s.targetDistance),
          distanceUnit: s.distanceUnit ?? null,
          targetRpe: dec(s.targetRpe),
          targetRir: dec(s.targetRir),
          notes: s.notes ?? null,
        });
      }
    }
  }
}

async function world(db: Db): Promise<World> {
  const [user, other] = [uuidv7() as UserId, uuidv7() as UserId];
  for (const [id, n] of [
    [user, 1],
    [other, 2],
  ] as const) {
    await db.execute(
      sql`INSERT INTO users (id, clerk_user_id) VALUES (${id}, ${`seed_fingerprint_${n}_${id}`})`,
    );
  }
  const [privateExercise, standardExercise] = [uuidv7(), uuidv7()];
  await db.insert(exercises).values([
    { id: privateExercise, ownerUserId: user, name: "FP press" },
    { id: standardExercise, name: `FP standard ${standardExercise}` },
  ]);
  const program = uuidv7();
  await db
    .insert(workoutPrograms)
    .values({ id: program, userId: user, name: "FP test", targetCycles: 3 });
  const tree = requestTree(privateExercise, standardExercise);
  await insertTree(db, program, 1, tree);
  return { db, user, other, program, cycle1: tree.id!, tree };
}

function withWorld(fn: (w: World) => Promise<void>): Promise<void> {
  return inRolledBackTransaction(async (client) => {
    const db = createDb(client);
    // The client is mid-transaction, so `db` behaves as the caller's `tx`.
    await fn(await world(db));
  });
}

/** `db` here is already inside a transaction; `clonePlan` wants a `Tx`. */
const asTx = (db: Db) => db as unknown as Parameters<typeof clonePlan>[0];

describe("stored cycle fingerprints", () => {
  it("a stored cycle fingerprints like the tree it was written from", () =>
    withWorld(async ({ db, user, cycle1, tree }) => {
      const stored = await storedCycleFingerprint(db, user, cycle1);
      assert.equal(stored, cycleFingerprint(tree));
    }));

  it("reads the tree back whole and wire-shaped: ids, order, notes, numerics as numbers", () =>
    withWorld(async ({ db, user, program, cycle1, tree }) => {
      const read = (await readCycleTrees(db, user, [cycle1])).get(cycle1)!;
      assert.equal(read.id, cycle1);
      assert.equal(read.programId, program);
      assert.equal(read.cycleNumber, 1);
      assert.equal(read.notes, "cycle notes");
      assert.deepEqual(
        read.workouts.map((w) => w.id),
        tree.workouts.map((w) => w.id),
      );
      const push = read.workouts[0]!;
      assert.equal(push.notes, "Rest 2 min");
      assert.deepEqual(
        push.plannedExercises.map((pe) => pe.id),
        tree.workouts[0]!.plannedExercises.map((pe) => pe.id),
      );
      const set1 = push.plannedExercises[0]!.plannedSets[0]!;
      // Postgres stores "135.50" and "8.0"; the tree carries the wire's
      // numbers, so it diffs against a request without converting ...
      assert.equal(set1.targetWeight, 135.5);
      assert.equal(set1.targetRpe, 8);
      assert.equal(set1.targetRir, null);
      assert.equal(push.plannedExercises[0]!.plannedSets[1]!.targetRir, 2);
      assert.equal(set1.notes, "go heavy");
      // ... with every column present, null or not, as in the shared nodes.
      assert.deepEqual(Object.keys(push).sort(), [
        "id",
        "name",
        "notes",
        "plannedExercises",
        "position",
      ]);
      assert.deepEqual(Object.keys(push.plannedExercises[0]!).sort(), [
        "exerciseId",
        "groupKey",
        "id",
        "notes",
        "placeholderLabel",
        "plannedSets",
        "position",
        "targetSets",
      ]);
      assert.deepEqual(Object.keys(set1).sort(), [
        "distanceUnit",
        "id",
        "notes",
        "setNumber",
        "targetDistance",
        "targetDurationSeconds",
        "targetRepsMax",
        "targetRepsMin",
        "targetRir",
        "targetRpe",
        "targetWeight",
        "weightUnit",
      ]);
      // The fingerprint does not care either way.
      assert.equal(cycleFingerprint(read), cycleFingerprint(tree));
    }));

  it("a clonePlan copy to a new cycle fingerprints like its source", () =>
    withWorld(async ({ db, user, program, cycle1 }) => {
      const copy = uuidv7();
      await clonePlan(asTx(db), user, {
        sourcePlanId: cycle1,
        target: { programId: program, newPlanId: copy, cycleNumber: 2 },
      });
      const fps = await storedCycleFingerprints(db, user, [cycle1, copy]);
      assert.equal(fps.size, 2);
      assert.equal(fps.get(copy), fps.get(cycle1));
    }));

  it("a clone over an authored cycle makes it match, plan name aside", () =>
    withWorld(async ({ db, user, program, cycle1, tree }) => {
      const slots = tree.workouts[0]!.plannedExercises;
      const deload = requestTree(slots[0]!.exerciseId!, slots[1]!.exerciseId!);
      deload.name = "Deload";
      deload.workouts[0]!.plannedExercises[0]!.plannedSets[0]!.targetWeight = 95;
      await insertTree(db, program, 3, deload);
      const source = await storedCycleFingerprint(db, user, cycle1);
      assert.notEqual(
        await storedCycleFingerprint(db, user, deload.id!),
        source,
        "an authored deload looks different",
      );
      await clonePlan(asTx(db), user, {
        sourcePlanId: cycle1,
        target: { existingPlanId: deload.id! },
      });
      assert.equal(await storedCycleFingerprint(db, user, deload.id!), source);
    }));

  it("moves with a stored target column, not with stored notes", () =>
    withWorld(async ({ db, user, cycle1, tree }) => {
      const before = await storedCycleFingerprint(db, user, cycle1);
      const setId = tree.workouts[0]!.plannedExercises[0]!.plannedSets[0]!.id!;
      const workoutId = tree.workouts[0]!.id!;

      await db
        .update(workouts)
        .set({ notes: "new notes" })
        .where(eq(workouts.id, workoutId));
      await db
        .update(plannedSets)
        .set({ notes: "new notes" })
        .where(eq(plannedSets.id, setId));
      await db
        .update(workoutPlans)
        .set({ notes: "new notes" })
        .where(eq(workoutPlans.id, cycle1));
      assert.equal(await storedCycleFingerprint(db, user, cycle1), before);

      await db
        .update(plannedSets)
        .set({ targetWeight: "135.51" })
        .where(eq(plannedSets.id, setId));
      const reweighed = await storedCycleFingerprint(db, user, cycle1);
      assert.notEqual(reweighed, before);

      // The same effort, moved from RPE to RIR, is a different target.
      await db
        .update(plannedSets)
        .set({ targetRpe: null, targetRir: "8" })
        .where(eq(plannedSets.id, setId));
      assert.notEqual(
        await storedCycleFingerprint(db, user, cycle1),
        reweighed,
      );
    }));

  it("an empty cycle fingerprints like an empty tree", () =>
    withWorld(async ({ db, user, program }) => {
      const empty = uuidv7();
      await db
        .insert(workoutPlans)
        .values({ id: empty, programId: program, cycleNumber: 2 });
      assert.equal(
        await storedCycleFingerprint(db, user, empty),
        cycleFingerprint({ workouts: [] }),
      );
    }));

  it("another user's plan id is refused, not fingerprinted as empty", () =>
    withWorld(async ({ db, other, cycle1 }) => {
      await assert.rejects(
        storedCycleFingerprint(db, other, cycle1),
        CrossTenantReferenceError,
      );
      await assert.rejects(
        readCycleTrees(db, other, [cycle1]),
        CrossTenantReferenceError,
      );
      await assert.rejects(
        storedCycleFingerprints(db, other, [uuidv7()]),
        CrossTenantReferenceError,
      );
    }));
});
