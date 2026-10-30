// The clone primitive (operations.md 0.2; design D3 of the step-3 change).
// Copies one cycle's subtree -- workouts -> planned exercises -> planned sets
// -- onto a target plan. Written once for its three callers:
//
// 1. create a fixed-length program: build cycle 1, clone it N-1 times (3.1);
//    extend a program by one cycle (3.12) is the same shape;
// 2. copy from an old program: clone its cycle 1 into a new program (3.9);
// 3. apply an edit to remaining cycles: clone the edited cycle over each
//    later, untrained cycle (3.8).
//
// One pass per level. Ids are minted here, in application code, before each
// level is written, so the old -> new map for the level below already exists
// -- no RETURNING, no rejoin on a natural key. Nothing in the plan tree
// self-references (data-model.md 2.8), so no level needs a second pass.
import { and, eq, inArray, notInArray, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  plannedExercises,
  plannedSets,
  workoutPlans,
  workouts,
} from "./schema";
import { assertOwned, userScope, type Tx, type UserId } from "./scope";

/** A new cycle row under `programId`. Callers 1 and 2. */
export interface NewPlanTarget {
  programId: string;
  newPlanId: string;
  cycleNumber: number;
  name?: string | null;
  notes?: string | null;
}

/**
 * An existing cycle whose subtree is replaced. Caller 3. The plan row itself
 * (cycle number, name, notes) is left alone.
 */
export interface ExistingPlanTarget {
  existingPlanId: string;
}

export type CloneTarget = NewPlanTarget | ExistingPlanTarget;

/** Source id -> clone id, per level. JSON-safe, so a caller can persist it. */
export interface CloneIdMaps {
  workouts: Readonly<Record<string, string>>;
  plannedExercises: Readonly<Record<string, string>>;
  plannedSets: Readonly<Record<string, string>>;
}

export interface CloneResult extends CloneIdMaps {
  /** The plan the subtree now hangs under: `newPlanId` or `existingPlanId`. */
  planId: string;
}

export interface ClonePlanInput {
  sourcePlanId: string;
  target: CloneTarget;
  /**
   * Ids to reuse instead of minting -- normally a previous call's result. A
   * rerun with the same target and the same ids writes nothing (every insert
   * is `ON CONFLICT (id) DO NOTHING`). Source rows absent from a map get a
   * fresh UUIDv7.
   */
  ids?: Partial<CloneIdMaps>;
}

/**
 * A clone id already exists somewhere other than where this clone would put
 * it: a stale or forged id map, or a `newPlanId` that is another cycle's (or
 * another user's). Raised instead of letting `ON CONFLICT DO NOTHING` report
 * success for a row it did not write.
 */
export class CloneConflictError extends Error {
  constructor(
    readonly table: string,
    readonly ids: readonly string[],
  ) {
    super(`${table}: ${ids.length} clone id(s) already exist elsewhere`);
    this.name = "CloneConflictError";
  }
}

/**
 * Copies the source plan's workouts, planned exercises and planned sets onto
 * the target plan, preserving names, positions, set numbers, targets, group
 * keys and notes. Runs inside the caller's transaction -- a half-cloned cycle
 * is a mess to detect (operations.md 3.1) -- hence `Tx`, not a handle.
 *
 * After it returns, the target plan's subtree is exactly the clone: any
 * workout under the target that is not part of it is deleted first, with its
 * subtree. For a new-plan target that is a no-op; for an existing plan it is
 * 3.8's delete-and-re-clone. Choosing *which* cycles to replace -- untrained
 * ones, confirmed by the user against the structural guard -- is the
 * caller's job (3.8): a trained workout is `RESTRICT`ed by its sessions and
 * makes this throw, which is a safety net, not control flow.
 *
 * Ownership: the source plan and the target (program, or plan) must be the
 * user's, else `CrossTenantReferenceError`. Every clone id is then checked to
 * sit under its intended parent, else `CloneConflictError`.
 */
export async function clonePlan(
  tx: Tx,
  userId: UserId,
  input: ClonePlanInput,
): Promise<CloneResult> {
  const { sourcePlanId, target } = input;
  const scope = userScope(userId);

  await assertOwned(tx, userId, "workoutPlans", [sourcePlanId]);
  let planId: string;
  if ("existingPlanId" in target) {
    planId = target.existingPlanId;
    if (planId === sourcePlanId) {
      throw new Error("clonePlan: a plan cannot be cloned over itself");
    }
    await assertOwned(tx, userId, "workoutPlans", [planId]);
  } else {
    planId = target.newPlanId;
    await assertOwned(tx, userId, "workoutPrograms", [target.programId]);
    await tx
      .insert(workoutPlans)
      .values({
        id: planId,
        programId: target.programId,
        cycleNumber: target.cycleNumber,
        name: target.name ?? null,
        notes: target.notes ?? null,
      })
      .onConflictDoNothing({ target: workoutPlans.id });
    const [plan] = await tx
      .select({
        programId: workoutPlans.programId,
        cycleNumber: workoutPlans.cycleNumber,
      })
      .from(workoutPlans)
      .where(and(scope.workoutPlans, eq(workoutPlans.id, planId)));
    if (
      plan?.programId !== target.programId ||
      plan.cycleNumber !== target.cycleNumber
    ) {
      throw new CloneConflictError("workout_plans", [planId]);
    }
  }

  // --- workouts ------------------------------------------------------------
  const srcWorkouts = await tx
    .select({
      id: workouts.id,
      name: workouts.name,
      position: workouts.position,
      notes: workouts.notes,
    })
    .from(workouts)
    .where(and(scope.workouts, eq(workouts.planId, sourcePlanId)));
  const workoutMap = mint(srcWorkouts, input.ids?.workouts);
  const newWorkoutIds = Object.values(workoutMap);

  // Whatever hangs under the target and is not this clone goes first, so the
  // position uniques never see old and new rows side by side.
  await tx
    .delete(workouts)
    .where(
      and(
        scope.workouts,
        eq(workouts.planId, planId),
        excluding(workouts.id, newWorkoutIds),
      ),
    );
  if (srcWorkouts.length > 0) {
    await tx
      .insert(workouts)
      .values(
        srcWorkouts.map((w) => ({
          id: workoutMap[w.id]!,
          planId,
          name: w.name,
          position: w.position,
          notes: w.notes,
        })),
      )
      .onConflictDoNothing({ target: workouts.id });
  }
  await expectParents(
    tx,
    "workouts",
    workouts,
    workouts.planId,
    scope.workouts,
    Object.fromEntries(newWorkoutIds.map((id) => [id, planId])),
  );

  // --- planned exercises ---------------------------------------------------
  const srcExercises =
    srcWorkouts.length === 0
      ? []
      : await tx
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
              inArray(
                plannedExercises.workoutId,
                srcWorkouts.map((w) => w.id),
              ),
            ),
          );
  const exerciseMap = mint(srcExercises, input.ids?.plannedExercises);
  const exerciseParent = Object.fromEntries(
    srcExercises.map((e) => [exerciseMap[e.id]!, workoutMap[e.workoutId]!]),
  );

  if (newWorkoutIds.length > 0) {
    await tx
      .delete(plannedExercises)
      .where(
        and(
          scope.plannedExercises,
          inArray(plannedExercises.workoutId, newWorkoutIds),
          excluding(plannedExercises.id, Object.keys(exerciseParent)),
        ),
      );
  }
  if (srcExercises.length > 0) {
    await tx
      .insert(plannedExercises)
      .values(
        srcExercises.map((e) => ({
          id: exerciseMap[e.id]!,
          workoutId: workoutMap[e.workoutId]!,
          exerciseId: e.exerciseId,
          placeholderLabel: e.placeholderLabel,
          position: e.position,
          targetSets: e.targetSets,
          groupKey: e.groupKey,
          notes: e.notes,
        })),
      )
      .onConflictDoNothing({ target: plannedExercises.id });
  }
  await expectParents(
    tx,
    "planned_exercises",
    plannedExercises,
    plannedExercises.workoutId,
    scope.plannedExercises,
    exerciseParent,
  );

  // --- planned sets --------------------------------------------------------
  const srcSets =
    srcExercises.length === 0
      ? []
      : await tx
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
              inArray(
                plannedSets.plannedExerciseId,
                srcExercises.map((e) => e.id),
              ),
            ),
          );
  const setMap = mint(srcSets, input.ids?.plannedSets);
  const setParent = Object.fromEntries(
    srcSets.map((s) => [setMap[s.id]!, exerciseMap[s.plannedExerciseId]!]),
  );

  const newExerciseIds = Object.keys(exerciseParent);
  if (newExerciseIds.length > 0) {
    await tx
      .delete(plannedSets)
      .where(
        and(
          scope.plannedSets,
          inArray(plannedSets.plannedExerciseId, newExerciseIds),
          excluding(plannedSets.id, Object.keys(setParent)),
        ),
      );
  }
  if (srcSets.length > 0) {
    await tx
      .insert(plannedSets)
      .values(
        // target_weight_kg is generated; never written.
        srcSets.map(({ id, plannedExerciseId, ...rest }) => ({
          ...rest,
          id: setMap[id]!,
          plannedExerciseId: exerciseMap[plannedExerciseId]!,
        })),
      )
      .onConflictDoNothing({ target: plannedSets.id });
  }
  await expectParents(
    tx,
    "planned_sets",
    plannedSets,
    plannedSets.plannedExerciseId,
    scope.plannedSets,
    setParent,
  );

  return {
    planId,
    workouts: workoutMap,
    plannedExercises: exerciseMap,
    plannedSets: setMap,
  };
}

/** Source id -> clone id: the caller's id where given, else a fresh UUIDv7. */
function mint(
  rows: readonly { id: string }[],
  reuse: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.id, reuse?.[r.id] ?? uuidv7()]));
}

/** `column NOT IN (ids)`, or nothing when `ids` is empty. */
function excluding(
  column: Parameters<typeof notInArray>[0],
  ids: readonly string[],
): SQL | undefined {
  return ids.length === 0 ? undefined : notInArray(column, [...ids]);
}

/**
 * Proves every clone id is a row under its intended parent. `ON CONFLICT DO
 * NOTHING` is what makes a rerun free, and also what would let an id that
 * already belongs to some other row pass silently; this is the check that
 * tells the two apart. Scoped: another user's row reads as missing, which is
 * the same error.
 */
async function expectParents(
  tx: Tx,
  name: string,
  table: typeof workouts | typeof plannedExercises | typeof plannedSets,
  parentColumn:
    | typeof workouts.planId
    | typeof plannedExercises.workoutId
    | typeof plannedSets.plannedExerciseId,
  scoped: SQL,
  expected: Readonly<Record<string, string>>,
): Promise<void> {
  const ids = Object.keys(expected);
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: table.id, parent: parentColumn })
    .from(table)
    .where(and(scoped, inArray(table.id, ids)));
  const found = new Map(rows.map((r) => [r.id, r.parent]));
  const wrong = ids.filter((id) => found.get(id) !== expected[id]);
  if (wrong.length > 0) throw new CloneConflictError(name, wrong);
}
