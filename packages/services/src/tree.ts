// Writing a cycle tree (operations.md 0.2, 3.1, 3.7; design D3, D4 of
// step-4a-program-builder): the row each node becomes, the client-minted
// inserts, and the checks a tree must pass before any of it is written.
import {
  CrossTenantReferenceError,
  assertExercisesUsable,
  plannedExercises,
  plannedSets,
  workoutPlans,
  workouts,
  type Tx,
  type UserId,
} from "@workout-tracker/db";
import {
  duplicateIdMessage,
  firstDuplicateId,
  slotLabel,
  type CycleTree,
  type PlannedExerciseNode,
  type PlannedSetNode,
  type WorkoutNode,
} from "@workout-tracker/shared";
import { conflict, invalid } from "./errors";

// --- Checks --------------------------------------------------------------------

/**
 * Refuses (`invalid`) a cycle tree that uses one id twice: the plan, a
 * workout, a slot or a set. The `cycleTree` contract refuses this too, but a
 * caller that never parsed one (an MCP tool, a test) must not get a diff that
 * silently collapses two rows into one. Same check and message as the
 * contract.
 */
export function assertDistinctIds(cycle: CycleTree): void {
  const duplicate = firstDuplicateId(cycle);
  if (duplicate !== undefined) throw invalid(duplicateIdMessage(duplicate));
}

/**
 * `assertExercisesUsable` over every exercise a cycle references, refusing
 * with the first offending slot named rather than a bare "not found".
 */
export async function assertCycleExercisesUsable(
  tx: Tx,
  user: UserId,
  cycle: CycleTree,
): Promise<void> {
  const ids = cycle.workouts.flatMap((w) =>
    w.plannedExercises.flatMap((s) => (s.exerciseId ? [s.exerciseId] : [])),
  );
  try {
    await assertExercisesUsable(tx, user, ids);
  } catch (error) {
    if (!(error instanceof CrossTenantReferenceError)) throw error;
    const missing = new Set(error.ids);
    for (const w of cycle.workouts) {
      for (const s of w.plannedExercises) {
        if (s.exerciseId && missing.has(s.exerciseId)) {
          throw invalid(
            `${slotLabel(w, s)}: that exercise isn't in your catalog.`,
          );
        }
      }
    }
    throw error;
  }
}

// --- Rows ----------------------------------------------------------------------

/** A request number as a `numeric` column value. */
function decimal(value: number | null): string | null {
  return value === null ? null : String(value);
}

export function workoutRow(planId: string, w: WorkoutNode) {
  return {
    id: w.id,
    planId,
    name: w.name,
    position: w.position,
    notes: w.notes,
  };
}

export function slotRow(workoutId: string, s: PlannedExerciseNode) {
  return { id: s.id, ...slotColumns(workoutId, s) };
}

/** A slot's row without its id: what an in-place update writes. */
export function slotColumns(workoutId: string, s: PlannedExerciseNode) {
  return {
    workoutId,
    exerciseId: s.exerciseId,
    placeholderLabel: s.placeholderLabel,
    position: s.position,
    targetSets: s.targetSets,
    groupKey: s.groupKey,
    notes: s.notes,
  };
}

export function setRow(plannedExerciseId: string, s: PlannedSetNode) {
  return {
    id: s.id,
    plannedExerciseId,
    setNumber: s.setNumber,
    targetRepsMin: s.targetRepsMin,
    targetRepsMax: s.targetRepsMax,
    targetWeight: decimal(s.targetWeight),
    weightUnit: s.weightUnit,
    targetDurationSeconds: s.targetDurationSeconds,
    targetDistance: decimal(s.targetDistance),
    distanceUnit: s.distanceUnit,
    targetRpe: decimal(s.targetRpe),
    targetRir: decimal(s.targetRir),
    notes: s.notes,
  };
}

// --- Client-minted inserts -------------------------------------------------------

const ID_TAKEN =
  "Part of this program has an id that is already in use. Reload and try again.";

/**
 * After an `ON CONFLICT (id) DO NOTHING` insert of client-minted rows: refuses
 * (`conflict`) unless every row was written. An id that already exists
 * anywhere -- another cycle, another user -- must not read as success.
 */
export function assertAllWritten(
  written: readonly unknown[],
  expected: number,
): void {
  if (written.length !== expected) throw conflict(ID_TAKEN);
}

export async function insertWorkouts(
  tx: Tx,
  rows: ReturnType<typeof workoutRow>[],
): Promise<void> {
  if (rows.length === 0) return;
  const written = await tx
    .insert(workouts)
    .values(rows)
    .onConflictDoNothing({ target: workouts.id })
    .returning({ id: workouts.id });
  assertAllWritten(written, rows.length);
}

export async function insertSlots(
  tx: Tx,
  rows: ReturnType<typeof slotRow>[],
): Promise<void> {
  if (rows.length === 0) return;
  const written = await tx
    .insert(plannedExercises)
    .values(rows)
    .onConflictDoNothing({ target: plannedExercises.id })
    .returning({ id: plannedExercises.id });
  assertAllWritten(written, rows.length);
}

export async function insertSets(
  tx: Tx,
  rows: ReturnType<typeof setRow>[],
): Promise<void> {
  if (rows.length === 0) return;
  const written = await tx
    .insert(plannedSets)
    .values(rows)
    .onConflictDoNothing({ target: plannedSets.id })
    .returning({ id: plannedSets.id });
  assertAllWritten(written, rows.length);
}

/**
 * Writes a cycle tree as cycle `cycleNumber` of `programId`, every id the
 * client's: the plan, then one insert per level (operations.md 0.2). The
 * caller owns the transaction and has checked the program is the user's.
 */
export async function insertCycleTree(
  tx: Tx,
  user: UserId,
  programId: string,
  cycleNumber: number,
  cycle: CycleTree,
): Promise<void> {
  assertDistinctIds(cycle);
  await assertCycleExercisesUsable(tx, user, cycle);
  const plan = await tx
    .insert(workoutPlans)
    .values({ id: cycle.id, programId, cycleNumber })
    .onConflictDoNothing({ target: workoutPlans.id })
    .returning({ id: workoutPlans.id });
  assertAllWritten(plan, 1);

  await insertWorkouts(
    tx,
    cycle.workouts.map((w) => workoutRow(cycle.id, w)),
  );
  const slots = cycle.workouts.flatMap((w) =>
    w.plannedExercises.map((s) => ({ workoutId: w.id, s })),
  );
  await insertSlots(
    tx,
    slots.map(({ workoutId, s }) => slotRow(workoutId, s)),
  );
  await insertSets(
    tx,
    slots.flatMap(({ s }) => s.plannedSets.map((p) => setRow(s.id, p))),
  );
}
