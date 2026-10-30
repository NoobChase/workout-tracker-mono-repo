// Stored cycles, read for the fingerprint (operations.md 3.8; step-4a design
// D6) and for everything else that needs a whole cycle: the builder's cycle
// read, the apply preview and the save's diff. The normalizer itself is pure
// and lives in `fingerprint-core.ts` (re-exported here), so a stored cycle and
// a request tree always go through the same one.
import { and, asc, inArray } from "drizzle-orm";
import {
  cycleFingerprint,
  type DistanceUnit,
  type WeightUnit,
} from "./fingerprint-core";
import {
  distanceUnit,
  plannedExercises,
  plannedSets,
  weightUnit,
  workoutPlans,
  workouts,
} from "./schema";
import { assertOwned, userScope, type Executor, type UserId } from "./scope";

export * from "./fingerprint-core";

// fingerprint-core.ts spells the unit enums out so it imports nothing from
// the schema; these fail to compile if the two ever disagree.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const weightUnitsAgree: Same<
  WeightUnit,
  (typeof weightUnit.enumValues)[number]
> = true;
const distanceUnitsAgree: Same<
  DistanceUnit,
  (typeof distanceUnit.enumValues)[number]
> = true;
void weightUnitsAgree;
void distanceUnitsAgree;

// --- The stored cycle tree -----------------------------------------------------
//
// A cycle as `readCycleTrees` returns it: in the wire shape of the
// `packages/shared` cycle-tree nodes -- every column present, `numeric`
// columns as numbers -- so the services hand it out and diff it against a
// request without converting. Field names are schema.ts's.

export interface StoredCyclePlannedSet {
  id: string;
  setNumber: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetWeight: number | null;
  weightUnit: WeightUnit | null;
  targetDurationSeconds: number | null;
  targetDistance: number | null;
  distanceUnit: DistanceUnit | null;
  targetRpe: number | null;
  targetRir: number | null;
  notes: string | null;
}

export interface StoredCyclePlannedExercise {
  id: string;
  exerciseId: string | null;
  placeholderLabel: string | null;
  position: number;
  targetSets: number;
  groupKey: number | null;
  notes: string | null;
  plannedSets: StoredCyclePlannedSet[];
}

export interface StoredCycleWorkout {
  id: string;
  name: string;
  position: number;
  notes: string | null;
  plannedExercises: StoredCyclePlannedExercise[];
}

export interface StoredCycleTree {
  /** The `workout_plans` id. */
  id: string;
  programId: string;
  cycleNumber: number;
  name: string | null;
  notes: string | null;
  workouts: StoredCycleWorkout[];
}

// --- Stored fingerprints -------------------------------------------------------

/**
 * Fingerprints of stored cycles, keyed by plan id: four queries however many
 * plans (D10's no-N+1 rule). Throws `CrossTenantReferenceError` for a plan id
 * that is not the user's, rather than fingerprinting it as an empty cycle.
 */
export async function storedCycleFingerprints(
  db: Executor,
  userId: UserId,
  planIds: readonly string[],
): Promise<Map<string, string>> {
  const trees = await readCycleTrees(db, userId, planIds);
  return new Map(
    [...trees].map(([planId, tree]) => [planId, cycleFingerprint(tree)]),
  );
}

/** `storedCycleFingerprints` for one plan. */
export async function storedCycleFingerprint(
  db: Executor,
  userId: UserId,
  planId: string,
): Promise<string> {
  const map = await storedCycleFingerprints(db, userId, [planId]);
  return map.get(planId)!;
}

// --- Stored cycles -------------------------------------------------------------

/** A `numeric` column as the wire's number. Exact at these columns' scales. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Reads whole cycles -- plan, workouts, planned exercises, planned sets, notes
 * and ids included -- through `userScope`, one query per level for all the
 * plans at once. Every level comes back ordered (position, set number). Pass
 * the `tx` when the result must agree with a write in the same transaction.
 */
export async function readCycleTrees(
  db: Executor,
  userId: UserId,
  planIds: readonly string[],
): Promise<Map<string, StoredCycleTree>> {
  const wanted = [...new Set(planIds)];
  const result = new Map<string, StoredCycleTree>();
  if (wanted.length === 0) return result;
  await assertOwned(db, userId, "workoutPlans", wanted);
  const scope = userScope(userId);

  const plans = await db
    .select({
      id: workoutPlans.id,
      programId: workoutPlans.programId,
      cycleNumber: workoutPlans.cycleNumber,
      name: workoutPlans.name,
      notes: workoutPlans.notes,
    })
    .from(workoutPlans)
    .where(and(scope.workoutPlans, inArray(workoutPlans.id, wanted)));
  for (const p of plans) result.set(p.id, { ...p, workouts: [] });

  const ws = await db
    .select({
      id: workouts.id,
      planId: workouts.planId,
      name: workouts.name,
      position: workouts.position,
      notes: workouts.notes,
    })
    .from(workouts)
    .where(and(scope.workouts, inArray(workouts.planId, wanted)))
    .orderBy(asc(workouts.position));
  const byWorkout = new Map<string, StoredCycleWorkout>();
  for (const { planId, ...w } of ws) {
    const node: StoredCycleWorkout = { ...w, plannedExercises: [] };
    byWorkout.set(w.id, node);
    result.get(planId)!.workouts.push(node);
  }
  if (byWorkout.size === 0) return result;

  const pes = await db
    .select({
      id: plannedExercises.id,
      workoutId: plannedExercises.workoutId,
      exerciseId: plannedExercises.exerciseId,
      placeholderLabel: plannedExercises.placeholderLabel,
      position: plannedExercises.position,
      targetSets: plannedExercises.targetSets,
      groupKey: plannedExercises.groupKey,
      notes: plannedExercises.notes,
    })
    .from(plannedExercises)
    .where(
      and(
        scope.plannedExercises,
        inArray(plannedExercises.workoutId, [...byWorkout.keys()]),
      ),
    )
    .orderBy(asc(plannedExercises.position));
  const bySlot = new Map<string, StoredCyclePlannedExercise>();
  for (const { workoutId, ...pe } of pes) {
    const node: StoredCyclePlannedExercise = { ...pe, plannedSets: [] };
    bySlot.set(pe.id, node);
    byWorkout.get(workoutId)!.plannedExercises.push(node);
  }
  if (bySlot.size === 0) return result;

  const sets = await db
    .select({
      id: plannedSets.id,
      plannedExerciseId: plannedSets.plannedExerciseId,
      setNumber: plannedSets.setNumber,
      targetRepsMin: plannedSets.targetRepsMin,
      targetRepsMax: plannedSets.targetRepsMax,
      targetWeight: plannedSets.targetWeight,
      weightUnit: plannedSets.weightUnit,
      targetDurationSeconds: plannedSets.targetDurationSeconds,
      targetDistance: plannedSets.targetDistance,
      distanceUnit: plannedSets.distanceUnit,
      targetRpe: plannedSets.targetRpe,
      targetRir: plannedSets.targetRir,
      notes: plannedSets.notes,
    })
    .from(plannedSets)
    .where(
      and(
        scope.plannedSets,
        inArray(plannedSets.plannedExerciseId, [...bySlot.keys()]),
      ),
    )
    .orderBy(asc(plannedSets.setNumber));
  for (const { plannedExerciseId, ...s } of sets) {
    bySlot.get(plannedExerciseId)!.plannedSets.push({
      ...s,
      targetWeight: toNumber(s.targetWeight),
      targetDistance: toNumber(s.targetDistance),
      targetRpe: toNumber(s.targetRpe),
      targetRir: toNumber(s.targetRir),
    });
  }
  return result;
}
