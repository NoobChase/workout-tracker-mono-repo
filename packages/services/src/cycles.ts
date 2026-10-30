// A cycle: reading it (the builder's cycle read and the apply preview),
// editing it (operations.md 3.7) and applying the edit to later cycles (3.8):
// design D4, D5, D7 of step-4a-program-builder. The save is the only
// plan-editing write, so the apply is in the edit's transaction by
// construction. Online-only (0.3).
//
// Every lookup goes through `loadCycles`: the stored side of every comparison
// comes from `readCycleTrees`, already in the request's wire shape, and every
// comparison of content goes through the one normalizer -- `cycleFingerprint`
// for authored content, `cycleContentKey` for that plus notes (D6).
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import {
  canonicalJson,
  clonePlan,
  cycleContentKey,
  cycleFingerprint,
  plannedExercises,
  plannedSets,
  readCycleTrees,
  userScope,
  workoutPlans,
  workouts,
  type Db,
  type StoredCycleTree,
  type Tx,
  type UserId,
} from "@workout-tracker/db";
import type {
  ApplyPreviewResponse,
  CycleDetailResponse,
  CycleTree,
  PlannedSetNode,
  SaveCycleRequest,
  SaveCycleResponse,
  WorkoutNode,
} from "@workout-tracker/shared";
import { conflict, invalid, notFound, transact } from "./errors";
import {
  PROGRAM_NOT_FOUND,
  STALE,
  advanceProgram,
  lockProgram,
  readProgramRow,
  readSnapshot,
  trainedAtByWorkout,
  type ProgramRow,
} from "./plan";
import { toIso } from "./rows";
import {
  assertCycleExercisesUsable,
  assertDistinctIds,
  insertSets,
  insertSlots,
  insertWorkouts,
  setRow,
  slotColumns,
  slotRow,
  workoutRow,
} from "./tree";

// --- Loading cycles ------------------------------------------------------------

/** Some of a program's cycles, whole, with what is trained among them. */
interface LoadedCycles {
  /** The cycles found, by cycle number ascending. */
  plans: { id: string; cycleNumber: number }[];
  /** Each found cycle's tree, by plan id. */
  trees: Map<string, StoredCycleTree>;
  /** The trained workouts among them, with when each was first trained (D5). */
  trained: ReadonlyMap<string, Date>;
}

/**
 * Cycles of `programId` -- those numbered `which`, or every one `from` a
 * number on -- with their trees and trained workouts: one query per level
 * however many cycles. The first of `which` (or `from`) is the cycle asked
 * for, and missing it is `not_found`, naming the cycle, or the program if
 * that is what's missing; whether the others all exist is the caller's call.
 *
 * `lock` takes the found cycles' workouts `FOR UPDATE` before reading what is
 * trained. A session can only start on a workout by taking a key-share lock
 * on it, so "trained" then stays true until COMMIT.
 */
async function loadCycles(
  tx: Tx,
  user: UserId,
  programId: string,
  which: readonly number[] | { from: number },
  { lock = false }: { lock?: boolean } = {},
): Promise<LoadedCycles> {
  const scope = userScope(user);
  const wanted =
    "from" in which
      ? gte(workoutPlans.cycleNumber, which.from)
      : inArray(workoutPlans.cycleNumber, [...which]);
  const asked = "from" in which ? which.from : which[0];
  const plans = await tx
    .select({ id: workoutPlans.id, cycleNumber: workoutPlans.cycleNumber })
    .from(workoutPlans)
    .where(
      and(scope.workoutPlans, eq(workoutPlans.programId, programId), wanted),
    )
    .orderBy(asc(workoutPlans.cycleNumber));
  if (!plans.some((p) => p.cycleNumber === asked)) {
    throw notFound(
      (await readProgramRow(tx, user, programId))
        ? `Cycle ${asked} doesn't exist in this program.`
        : PROGRAM_NOT_FOUND,
    );
  }
  const planIds = plans.map((p) => p.id);
  if (lock) {
    await tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(scope.workouts, inArray(workouts.planId, planIds)))
      .for("update");
  }
  const trees = await readCycleTrees(tx, user, planIds);
  const trained = await trainedAtByWorkout(
    tx,
    user,
    [...trees.values()].flatMap((t) => t.workouts.map((w) => w.id)),
  );
  return { plans, trees, trained };
}

/** A cycle is trained if any of its workouts is (D5). */
function isTrained(
  tree: StoredCycleTree,
  trained: ReadonlyMap<string, Date>,
): boolean {
  return tree.workouts.some((w) => trained.has(w.id));
}

// --- Reads ---------------------------------------------------------------------

/**
 * Cycle `cycleNumber`'s whole tree, each workout flagged trained (frozen in
 * the editor, D5) with when it was first trained, and the cycle's fingerprint
 * (GET /programs/:id/cycles/:n). One snapshot (`readSnapshot`), so the tree,
 * the trained flags and the fingerprint agree. The builder sends the
 * fingerprint back as the save's `expected.source` (design D7, D17).
 */
export async function getCycle(
  db: Db,
  user: UserId,
  programId: string,
  cycleNumber: number,
): Promise<CycleDetailResponse> {
  return readSnapshot(db, async (tx) => {
    const { plans, trees, trained } = await loadCycles(tx, user, programId, [
      cycleNumber,
    ]);
    const tree = trees.get(plans[0]!.id)!;
    return {
      programId,
      cycleNumber,
      fingerprint: cycleFingerprint(tree),
      cycle: {
        id: tree.id,
        workouts: tree.workouts.map((w) => {
          const at = trained.get(w.id);
          return {
            ...w,
            trained: at !== undefined,
            trainedAt: at ? toIso(at) : null,
          };
        }),
      },
    };
  });
}

/**
 * What the apply-to-later-cycles choice shows (GET
 * /programs/:id/cycles/:n/apply-preview; D7): cycle n's fingerprint as it is
 * now, before the edit, and for each later cycle its fingerprint, whether it
 * is trained, and whether it matches cycle n. A read: the save re-checks all
 * of it under the program lock. One snapshot, so the fingerprints and trained
 * flags describe one moment.
 */
export async function getApplyPreview(
  db: Db,
  user: UserId,
  programId: string,
  cycleNumber: number,
): Promise<ApplyPreviewResponse> {
  return readSnapshot(db, async (tx) => {
    const { plans, trees, trained } = await loadCycles(tx, user, programId, {
      from: cycleNumber,
    });
    const [edited, ...later] = plans.map((p) => trees.get(p.id)!);
    const source = cycleFingerprint(edited!);
    return {
      cycleNumber,
      source,
      later: later.map((tree) => {
        const fingerprint = cycleFingerprint(tree);
        return {
          cycleNumber: tree.cycleNumber,
          fingerprint,
          trained: isTrained(tree, trained),
          matches: fingerprint === source,
        };
      }),
    };
  });
}

// --- The save (3.7, 3.8) ---------------------------------------------------------

/**
 * Saves cycle `cycleNumber` as `input.cycle` and, in the same transaction,
 * replaces each `applyTo` cycle's subtree with a clone of it (PUT
 * /programs/:id/cycles/:n; operations.md 3.7, 3.8; D4, D5, D7).
 *
 * 1. Locks the program row, then (`loadCycles`) the workouts of every cycle
 *    involved, so a finish's extension or completion, or a session starting
 *    on one of them, serializes with the save.
 * 2. `guard`: the request still describes what is stored, or its effect is
 *    already in place; anything else is a `conflict`.
 * 3. `applyDiff`: the stored cycle becomes the request, by id. A trained
 *    workout (any session, D5) is frozen.
 * 4. `applyToTargets`: the saved cycle is cloned over each chosen cycle not
 *    already identical to it, notes included (`clonePlan` with
 *    `existingPlanId`).
 * 5. Runs the finish's roll-over (`advanceProgram`, operations.md 4.13) under
 *    the lock already held: a save that removes an ACTIVE program's last
 *    unresolved workouts completes a fixed program, or gives an open-ended one
 *    its next cycle, so an ACTIVE program is never left with nothing next
 *    (design D8).
 *
 * A retried save whose effect is in place passes step 2, finds nothing to
 * write in steps 3 and 4, and finds the roll-over already done in step 5.
 *
 * `input.cycle` is expected to satisfy the `cycleTree` contract; a tree that
 * uses one id twice is refused here as well (`assertDistinctIds`), since the
 * by-id diff would otherwise collapse the two rows silently.
 */
export async function saveCycle(
  db: Db,
  user: UserId,
  programId: string,
  cycleNumber: number,
  input: SaveCycleRequest,
): Promise<SaveCycleResponse> {
  assertDistinctIds(input.cycle);
  const chosen = input.applyTo.map((t) => t.cycleNumber);
  return transact(db, async (tx) => {
    const program = await lockProgram(tx, user, programId);
    for (const k of chosen) {
      if (k <= cycleNumber) {
        throw invalid(
          `Cycle ${k} isn't after cycle ${cycleNumber}; an edit applies only to later cycles.`,
        );
      }
    }
    const loaded = await loadCycles(
      tx,
      user,
      programId,
      [cycleNumber, ...chosen],
      { lock: true },
    );
    const { stored, targets } = guard(program, cycleNumber, input, loaded);

    await assertCycleExercisesUsable(tx, user, input.cycle);
    await applyDiff(tx, user, stored, input.cycle, loaded.trained);
    await applyToTargets(tx, user, stored.id, input.cycle, targets);

    await advanceProgram(tx, user, programId);
    return { cycleNumber, applied: [...chosen].sort((a, b) => a - b) };
  });
}

/**
 * The stale guard (D7), over the cycles `loadCycles` read under the lock.
 * Returns the stored edited cycle and the chosen targets' trees.
 *
 * - Every chosen cycle exists, and the request edits the stored cycle (same
 *   plan id); else `conflict`.
 * - A COMPLETED program takes no new workout or slot (design D8, gap b).
 * - Goes ahead if everything is as previewed: the edited cycle still has the
 *   fingerprint it was loaded with, and each chosen cycle the one the preview
 *   showed, untrained. Or if the effect is already in place: the edited cycle
 *   and every chosen cycle already have the desired tree's content key --
 *   its fingerprint and every notes column -- so a retry writes nothing.
 *   Anything else is a `conflict`: reload and try again.
 */
function guard(
  program: ProgramRow,
  cycleNumber: number,
  input: SaveCycleRequest,
  { plans, trees, trained }: LoadedCycles,
): { stored: StoredCycleTree; targets: StoredCycleTree[] } {
  const byNumber = new Map(plans.map((p) => [p.cycleNumber, trees.get(p.id)!]));
  const stored = byNumber.get(cycleNumber)!;
  if (
    input.cycle.id !== stored.id ||
    plans.length !== 1 + input.applyTo.length
  ) {
    throw conflict(STALE);
  }
  if (program.status === "COMPLETED") assertNothingAdded(stored, input.cycle);

  const targets = input.applyTo.map((t) => ({
    expected: t.fingerprint,
    tree: byNumber.get(t.cycleNumber)!,
  }));
  const asPreviewed =
    cycleFingerprint(stored) === input.expected.source &&
    targets.every(
      (t) =>
        cycleFingerprint(t.tree) === t.expected && !isTrained(t.tree, trained),
    );
  const desired = cycleContentKey(input.cycle);
  const alreadyDone =
    cycleContentKey(stored) === desired &&
    targets.every((t) => cycleContentKey(t.tree) === desired);
  if (!asPreviewed && !alreadyDone) throw conflict(STALE);
  return { stored, targets: targets.map((t) => t.tree) };
}

/**
 * A COMPLETED program has every workout resolved, and so trained and frozen
 * (D5). What the freeze still allows -- a new workout, or a new slot -- would
 * leave it COMPLETED with something unresolved, so it is refused before the
 * diff (design D8, gap b). Extending it (3.12) is how it runs again.
 */
function assertNothingAdded(stored: StoredCycleTree, desired: CycleTree) {
  const workoutIds = new Set(stored.workouts.map((w) => w.id));
  const slotIds = new Set(
    stored.workouts.flatMap((w) => w.plannedExercises.map((s) => s.id)),
  );
  const added = desired.workouts.some(
    (w) =>
      !workoutIds.has(w.id) ||
      w.plannedExercises.some((s) => !slotIds.has(s.id)),
  );
  if (added) throw invalid(FINISHED);
}

const FINISHED = "This program is finished. Run another cycle to change it.";

/**
 * Clones the saved cycle (`sourcePlanId`, now `cycle`) over each target whose
 * content -- notes included -- differs from it, so a retried save rewrites
 * nothing and an edit to notes alone still reaches the chosen cycles. The
 * guard has already refused a trained target, unless every target already
 * matches, in which case nothing is cloned.
 */
async function applyToTargets(
  tx: Tx,
  user: UserId,
  sourcePlanId: string,
  cycle: CycleTree,
  targets: readonly StoredCycleTree[],
): Promise<void> {
  const content = cycleContentKey(cycle);
  for (const target of targets) {
    if (cycleContentKey(target) === content) continue;
    await clonePlan(tx, user, {
      sourcePlanId,
      target: { existingPlanId: target.id },
    });
  }
}

// --- The diff (D4, D5) -----------------------------------------------------------

/** Deep equality of plain data, key order ignored. */
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * Turns the stored cycle into `desired`, by id, level by level. Kept rows are
 * updated in place, so their ids -- which `session_exercises` points at --
 * survive. Planned sets have no referrers, and their set-number unique is not
 * deferrable, so a changed set is deleted and reinserted under the same id.
 * Workout and slot position uniques are deferred to COMMIT, which is what
 * lets rows trade places.
 */
async function applyDiff(
  tx: Tx,
  user: UserId,
  storedTree: StoredCycleTree,
  desired: CycleTree,
  trained: ReadonlyMap<string, Date>,
): Promise<void> {
  const scope = userScope(user);
  // Both sides are in the wire shape: numbers, every column present.
  const stored: readonly WorkoutNode[] = storedTree.workouts;
  assertFrozenKept(stored, desired.workouts, trained);

  const storedWorkouts = new Map(stored.map((w) => [w.id, w]));
  const desiredWorkouts = new Map(desired.workouts.map((w) => [w.id, w]));
  const storedSlots = slotsOf(stored);
  const desiredSlots = slotsOf(desired.workouts);
  const storedSets = setsOf(stored);
  const desiredSets = setsOf(desired.workouts);

  // Planned sets: anything not kept exactly (same slot, number, targets,
  // notes) goes, and is reinserted below if it is still wanted.
  const setGone = new Set(
    [...storedSets.values()]
      .filter((s) => {
        const d = desiredSets.get(s.set.id);
        return !d || d.slotId !== s.slotId || !same(d.set, s.set);
      })
      .map((s) => s.set.id),
  );
  if (setGone.size > 0) {
    await tx
      .delete(plannedSets)
      .where(and(scope.plannedSets, inArray(plannedSets.id, [...setGone])));
  }

  const slotGone = [...storedSlots.keys()].filter(
    (id) => !desiredSlots.has(id),
  );
  if (slotGone.length > 0) {
    await tx
      .delete(plannedExercises)
      .where(
        and(scope.plannedExercises, inArray(plannedExercises.id, slotGone)),
      );
  }

  await insertWorkouts(
    tx,
    desired.workouts
      .filter((w) => !storedWorkouts.has(w.id))
      .map((w) => workoutRow(desired.id, w)),
  );
  for (const w of desired.workouts) {
    const was = storedWorkouts.get(w.id);
    if (!was || same(workoutColumns(was), workoutColumns(w))) continue;
    await tx
      .update(workouts)
      .set(workoutColumns(w))
      .where(and(scope.workouts, eq(workouts.id, w.id)));
  }

  await insertSlots(
    tx,
    [...desiredSlots.values()]
      .filter(({ slot }) => !storedSlots.has(slot.id))
      .map(({ slot, workoutId }) => slotRow(workoutId, slot)),
  );
  for (const { slot, workoutId } of desiredSlots.values()) {
    const was = storedSlots.get(slot.id);
    if (!was) continue;
    const next = slotColumns(workoutId, slot);
    if (same(slotColumns(was.workoutId, was.slot), next)) continue;
    await tx
      .update(plannedExercises)
      .set(next)
      .where(and(scope.plannedExercises, eq(plannedExercises.id, slot.id)));
  }

  // After the slots: a slot moved out of a removed workout has its new
  // parent by now, so the cascade takes only what was meant to go.
  const workoutGone = stored
    .filter((w) => !desiredWorkouts.has(w.id))
    .map((w) => w.id);
  if (workoutGone.length > 0) {
    await tx
      .delete(workouts)
      .where(and(scope.workouts, inArray(workouts.id, workoutGone)));
  }

  const kept = new Set([...storedSets.keys()].filter((id) => !setGone.has(id)));
  await insertSets(
    tx,
    [...desiredSets.values()]
      .filter(({ set }) => !kept.has(set.id))
      .map(({ set, slotId }) => setRow(slotId, set)),
  );
}

/**
 * The trained-workout freeze (D5). A trained workout must come back with its
 * row, its subtree (ids included) and its position unchanged, and the set of
 * workouts before it may only shrink by removal: nothing inserted before it,
 * nothing moved across it. Refusals name the workout.
 */
function assertFrozenKept(
  stored: readonly WorkoutNode[],
  desired: readonly WorkoutNode[],
  trained: ReadonlyMap<string, Date>,
): void {
  const desiredById = new Map(desired.map((w) => [w.id, w]));
  const storedById = new Map(stored.map((w) => [w.id, w]));
  for (const w of stored) {
    if (!trained.has(w.id)) continue;
    const d = desiredById.get(w.id);
    if (!d) {
      throw conflict(
        `${w.name} already has a logged session, so it can't be removed.`,
      );
    }
    if (!same(frozenView(w), frozenView(d))) {
      throw conflict(
        `${w.name} already has a logged session, so it can't be changed or moved.`,
      );
    }
    const wasBefore = new Set(
      stored.filter((x) => x.position < w.position).map((x) => x.id),
    );
    for (const x of desired) {
      const nowBefore = x.position < d.position;
      const existed = storedById.has(x.id);
      if (nowBefore && !wasBefore.has(x.id)) {
        throw conflict(
          existed
            ? `${x.name} can't move before ${w.name}, which already has a logged session.`
            : `${x.name} can't go before ${w.name}, which already has a logged session.`,
        );
      }
      if (!nowBefore && wasBefore.has(x.id)) {
        throw conflict(
          `${x.name} can't move after ${w.name}, which already has a logged session.`,
        );
      }
    }
  }
}

/** Everything about a workout a trained session pins: all of it but nothing outside it. */
function frozenView(w: WorkoutNode) {
  return {
    ...workoutColumns(w),
    plannedExercises: [...w.plannedExercises]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        ...s,
        plannedSets: [...s.plannedSets].sort(
          (a, b) => a.setNumber - b.setNumber,
        ),
      })),
  };
}

function workoutColumns(w: WorkoutNode) {
  return { name: w.name, position: w.position, notes: w.notes };
}

function slotsOf(ws: readonly WorkoutNode[]) {
  return new Map(
    ws.flatMap((w) =>
      w.plannedExercises.map((slot) => [slot.id, { slot, workoutId: w.id }]),
    ),
  );
}

function setsOf(ws: readonly WorkoutNode[]) {
  return new Map(
    ws.flatMap((w) =>
      w.plannedExercises.flatMap((slot) =>
        slot.plannedSets.map(
          (set): [string, { set: PlannedSetNode; slotId: string }] => [
            set.id,
            { set, slotId: slot.id },
          ],
        ),
      ),
    ),
  );
}
