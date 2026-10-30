// Pieces every plan-side operation shares (operations.md 3.1-3.12; design D3,
// D5, D8, D10 of step-4a-program-builder): the program lock, the roll-over
// and the cycle it appends, the program summary with its current cycle, and
// "trained". Writing a cycle tree is `tree.ts`.
import { and, desc, eq, inArray, min, notExists } from "drizzle-orm";
import {
  clonePlan,
  userScope,
  workoutPlans,
  workoutPrograms,
  workoutSessions,
  workouts,
  type Db,
  type Executor,
  type Tx,
  type UserId,
} from "@workout-tracker/db";
import { newId, type ProgramSummary } from "@workout-tracker/shared";
import { notFound } from "./errors";
import { resolvingSession } from "./rows";

export const PROGRAM_NOT_FOUND = "That program doesn't exist.";
export const STALE =
  "This program changed after you opened it. Reload and try again.";

const summaryColumns = {
  id: workoutPrograms.id,
  name: workoutPrograms.name,
  status: workoutPrograms.status,
  targetCycles: workoutPrograms.targetCycles,
};
const programColumns = { ...summaryColumns, notes: workoutPrograms.notes };

/** A program row: its summary's columns and its notes. */
export type ProgramRow = Omit<ProgramSummary, "currentCycle"> & {
  notes: string | null;
};

/**
 * Locks the program row `FOR UPDATE` and returns it (design D8). Every write
 * to an existing plan takes this first -- the lock `finishWorkout` takes
 * before its exhaustion check -- so an edit, an extension and a finish's
 * completion serialize instead of interleaving.
 */
export async function lockProgram(
  tx: Tx,
  user: UserId,
  programId: string,
): Promise<ProgramRow> {
  const [row] = await tx
    .select(programColumns)
    .from(workoutPrograms)
    .where(
      and(userScope(user).workoutPrograms, eq(workoutPrograms.id, programId)),
    )
    .for("update");
  if (!row) throw notFound(PROGRAM_NOT_FOUND);
  return row;
}

/**
 * The exhaustion check and its consequence (operations.md 4.13): if every
 * workout of an ACTIVE program is resolved (`resolvingSession`), a fixed
 * program becomes COMPLETED and an open-ended one gains a cycle cloned from
 * its highest-numbered one (3.12). Returns whether a cycle was added.
 *
 * Takes the program lock first (a no-op if the caller already holds it).
 * Without it, two sessions finishing the last two unresolved workouts
 * concurrently would each see the other's as unresolved and neither would
 * extend, leaving an ACTIVE program with nothing next. With it they
 * serialize, and the second sees the first's commit.
 *
 * Callers: finish and skip (`sessions.ts`), activate (design D8 gap a) and
 * the cycle save (`cycles.ts`, D8 gap c), so an ACTIVE program is never left
 * with nothing next.
 */
export async function advanceProgram(
  tx: Tx,
  user: UserId,
  programId: string,
): Promise<boolean> {
  const scope = userScope(user);
  const program = await lockProgram(tx, user, programId);
  // Only an ACTIVE program advances. An ARCHIVED one was abandoned, not
  // finished (operations.md 3.10): a late session under it (say, started
  // offline from a cached workout) completes, but never extends the program
  // or marks it COMPLETED.
  if (program.status !== "ACTIVE") return false;

  const [unresolved] = await tx
    .select({ id: workouts.id })
    .from(workouts)
    .innerJoin(workoutPlans, eq(workoutPlans.id, workouts.planId))
    .where(
      and(
        scope.workouts,
        eq(workoutPlans.programId, programId),
        notExists(resolvingSession(tx, scope)),
      ),
    )
    .limit(1);
  if (unresolved) return false;

  if (program.targetCycles !== null) {
    // Fixed length, and its last cycle is trained: the one rule that writes
    // COMPLETED for a program (operations.md 3.10).
    await tx
      .update(workoutPrograms)
      .set({ status: "COMPLETED" })
      .where(and(scope.workoutPrograms, eq(workoutPrograms.id, programId)));
    return false;
  }

  // Open-ended: extend by one cycle, cloned from the highest-numbered one so
  // edits along the way carry forward (operations.md 3.12).
  return appendCycle(tx, user, programId, newId());
}

/**
 * Appends cycle n+1 as `newPlanId`, a clone of the program's highest-numbered
 * cycle n -- its subtree, name and notes (operations.md 3.12). Returns false,
 * writing nothing, if the program has no cycle. The caller holds the program
 * lock. Callers: the roll-over (`advanceProgram`) and `extendProgram`.
 */
export async function appendCycle(
  tx: Tx,
  user: UserId,
  programId: string,
  newPlanId: string,
): Promise<boolean> {
  const [source] = await tx
    .select({
      id: workoutPlans.id,
      cycleNumber: workoutPlans.cycleNumber,
      name: workoutPlans.name,
      notes: workoutPlans.notes,
    })
    .from(workoutPlans)
    .where(
      and(userScope(user).workoutPlans, eq(workoutPlans.programId, programId)),
    )
    .orderBy(desc(workoutPlans.cycleNumber))
    .limit(1);
  if (!source) return false;
  await clonePlan(tx, user, {
    sourcePlanId: source.id,
    target: {
      programId,
      newPlanId,
      cycleNumber: source.cycleNumber + 1,
      name: source.name,
      notes: source.notes,
    },
  });
  return true;
}

/**
 * Runs `fn` in a REPEATABLE READ, read-only transaction: every statement sees
 * the same snapshot, so a read made of one query per level never mixes rows
 * from before and after a concurrent save. Nothing is written, so no lock is
 * taken and no serialization failure is possible.
 */
export function readSnapshot<T>(db: Db, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(fn, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/** The program row, unlocked, or undefined if it is not the user's. */
export async function readProgramRow(
  db: Executor,
  user: UserId,
  programId: string,
): Promise<ProgramRow | undefined> {
  const [row] = await db
    .select(programColumns)
    .from(workoutPrograms)
    .where(
      and(userScope(user).workoutPrograms, eq(workoutPrograms.id, programId)),
    );
  return row;
}

/**
 * Programs with their progress (D10), two queries however many programs:
 * the rows, then each program's current cycle -- the lowest cycle that still
 * has a workout with no resolving session (`resolvingSession`, the same
 * condition what's-next uses). `programIds` omitted = all the user's.
 */
export async function programSummaries(
  db: Executor,
  user: UserId,
  programIds?: readonly string[],
): Promise<ProgramSummary[]> {
  if (programIds?.length === 0) return [];
  const scope = userScope(user);
  const only = programIds
    ? inArray(workoutPrograms.id, [...programIds])
    : undefined;
  const rows = await db
    .select(summaryColumns)
    .from(workoutPrograms)
    .where(and(scope.workoutPrograms, only))
    .orderBy(workoutPrograms.createdAt, workoutPrograms.id);
  if (rows.length === 0) return [];

  const current = await db
    .select({
      programId: workoutPlans.programId,
      cycle: min(workoutPlans.cycleNumber),
    })
    .from(workoutPlans)
    .innerJoin(workouts, eq(workouts.planId, workoutPlans.id))
    .where(
      and(
        scope.workoutPlans,
        programIds
          ? inArray(workoutPlans.programId, [...programIds])
          : undefined,
        notExists(resolvingSession(db, scope)),
      ),
    )
    .groupBy(workoutPlans.programId);
  const byProgram = new Map(current.map((c) => [c.programId, c.cycle]));
  return rows.map((r) => ({ ...r, currentCycle: byProgram.get(r.id) ?? null }));
}

/** One program's summary, or `not_found`. */
export async function programSummary(
  db: Executor,
  user: UserId,
  programId: string,
): Promise<ProgramSummary> {
  const [summary] = await programSummaries(db, user, [programId]);
  if (!summary) throw notFound(PROGRAM_NOT_FOUND);
  return summary;
}

/**
 * The trained workouts among `workoutIds` (D5) -- any session row references
 * them, whatever its status; an IN_PROGRESS session counts -- each with when
 * it was first trained: the earliest `performed_at` of those sessions. A
 * workout absent from the map is untrained. One grouped query.
 */
export async function trainedAtByWorkout(
  db: Executor,
  user: UserId,
  workoutIds: readonly string[],
): Promise<Map<string, Date>> {
  if (workoutIds.length === 0) return new Map();
  const rows = await db
    .select({
      workoutId: workoutSessions.workoutId,
      trainedAt: min(workoutSessions.performedAt),
    })
    .from(workoutSessions)
    .where(
      and(
        userScope(user).workoutSessions,
        inArray(workoutSessions.workoutId, [...workoutIds]),
      ),
    )
    .groupBy(workoutSessions.workoutId);
  return new Map(
    rows.flatMap((r) =>
      r.workoutId && r.trainedAt ? [[r.workoutId, r.trainedAt] as const] : [],
    ),
  );
}
