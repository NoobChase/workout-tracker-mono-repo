// Programs: create (operations.md 3.1; design D3), the reads (D10), and the
// lifecycle -- copy (3.9), activate (3.10), archive (3.11), rename and extend
// (3.12) (D8). Online-only (0.3). Every write to an existing program takes the
// program lock first (`lockProgram`).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  clonePlan,
  cycleFingerprint,
  storedCycleFingerprint,
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
import {
  newId,
  programLimits,
  type CopyProgramRequest,
  type CreateProgramRequest,
  type ExtendProgramRequest,
  type ProgramDetailResponse,
  type ProgramListResponse,
  type ProgramResponse,
  type RenameProgramRequest,
} from "@workout-tracker/shared";
import { conflict, invalid, transact } from "./errors";
import {
  assertProgramNameFree,
  programNameFor,
  programNameMatches,
  type ProgramNameMode,
} from "./names";
import {
  appendCycle,
  advanceProgram,
  lockProgram,
  programSummaries,
  programSummary,
  readProgramRow,
} from "./plan";
import { insertCycleTree } from "./tree";

const PROGRAM_ID_TAKEN = "That program id is already in use.";
const DIFFERENT_REPLAY =
  "A different program was already created with this id. Reload and try again.";

// --- Create (3.1, D3) ----------------------------------------------------------

/**
 * Creates a DRAFT program from its first cycle (POST /programs). One
 * transaction: the program, cycle 1 exactly as sent (every id the client's),
 * then `clonePlan` for cycles 2..`targetCycles` with server-minted ids. An
 * open-ended program (`targetCycles` null) materializes cycle 1 only.
 *
 * Idempotent on `programId` (`isReplay`): its name, `targetCycles` and cycle
 * 1 (by fingerprint) all equal to the request's returns the program and
 * writes nothing; any difference is a `conflict`. The name must be free
 * (exact match); manual create never auto-suffixes (D9).
 */
export async function createProgram(
  db: Db,
  user: UserId,
  input: CreateProgramRequest,
): Promise<ProgramResponse> {
  return transact(db, async (tx) => {
    await createProgramInTx(tx, user, input, "exact");
    return { program: await programSummary(tx, user, input.programId) };
  });
}

/**
 * The body of `createProgram`, for callers that add to its transaction
 * (template start activates in the same one), with the name picked per
 * `names` (`programNameFor`). Returns whether this call created the program
 * (false = a replay).
 */
export async function createProgramInTx(
  tx: Tx,
  user: UserId,
  input: CreateProgramRequest,
  names: ProgramNameMode,
): Promise<{ created: boolean }> {
  const replay = () =>
    isReplay(
      tx,
      user,
      {
        programId: input.programId,
        name: input.name,
        targetCycles: input.targetCycles,
        fingerprint: cycleFingerprint(input.cycle),
      },
      names,
    );
  if (await replay()) return { created: false };

  const inserted = await insertProgramRow(
    tx,
    user,
    {
      id: input.programId,
      name: await programNameFor(tx, user, input.name, names),
      notes: null,
      targetCycles: input.targetCycles,
    },
    replay,
  );
  if (!inserted) return { created: false };
  await insertCycleTree(tx, user, input.programId, 1, input.cycle);
  await fillCycles(
    tx,
    user,
    input.programId,
    input.cycle.id,
    input.targetCycles,
  );
  return { created: true };
}

/**
 * Inserts a new DRAFT program row under its client-minted id. Returns false
 * if the id was taken between the caller's replay check and this insert and
 * `isReplay` now recognises the row as this request's (a concurrent replay);
 * any other taken id -- another user's, say -- is a `conflict`.
 */
async function insertProgramRow(
  tx: Tx,
  user: UserId,
  program: {
    id: string;
    name: string;
    notes: string | null;
    targetCycles: number | null;
  },
  isReplay: () => Promise<boolean>,
): Promise<boolean> {
  const inserted = await tx
    .insert(workoutPrograms)
    .values({
      ...program,
      userId: user,
      status: "DRAFT",
      startDate: sql`CURRENT_DATE`,
    })
    .onConflictDoNothing({ target: workoutPrograms.id })
    .returning({ id: workoutPrograms.id });
  if (inserted.length > 0) return true;
  if (await isReplay()) return false;
  throw conflict(PROGRAM_ID_TAKEN);
}

/**
 * Materializes a fixed program's cycles 2..`targetCycles` as clones of cycle
 * 1 (`cycle1PlanId`) -- subtree, name and notes -- with server-minted ids. An
 * open-ended program (null) stays at one cycle.
 */
async function fillCycles(
  tx: Tx,
  user: UserId,
  programId: string,
  cycle1PlanId: string,
  targetCycles: number | null,
): Promise<void> {
  if (targetCycles === null || targetCycles < 2) return;
  const [plan] = await tx
    .select({ name: workoutPlans.name, notes: workoutPlans.notes })
    .from(workoutPlans)
    .where(
      and(userScope(user).workoutPlans, eq(workoutPlans.id, cycle1PlanId)),
    );
  for (let n = 2; n <= targetCycles; n++) {
    await clonePlan(tx, user, {
      sourcePlanId: cycle1PlanId,
      target: {
        programId,
        newPlanId: newId(),
        cycleNumber: n,
        name: plan?.name ?? null,
        notes: plan?.notes ?? null,
      },
    });
  }
}

/**
 * True if `want.programId` is already this user's program written by this
 * request -- create's or copy's (design D17): a name `programNameFor` could
 * have picked for `want.name` (`programNameMatches`), the same
 * `targetCycles`, and a cycle 1 fingerprinting as `want.fingerprint`. False
 * if no such program of theirs exists. `conflict` if it is theirs and differs
 * in any of them.
 *
 * A program renamed, extended or edited since is no longer recognised: a
 * replay arrives seconds after the original, not after later edits.
 */
async function isReplay(
  tx: Tx,
  user: UserId,
  want: {
    programId: string;
    name: string;
    targetCycles: number | null;
    fingerprint: string;
  },
  names: ProgramNameMode,
): Promise<boolean> {
  const existing = await readProgramRow(tx, user, want.programId);
  if (!existing) return false;
  if (
    !programNameMatches(names, existing.name, want.name) ||
    existing.targetCycles !== want.targetCycles
  ) {
    throw conflict(PROGRAM_ID_TAKEN);
  }
  if (
    (await cycleOneFingerprint(tx, user, want.programId)) !== want.fingerprint
  ) {
    throw conflict(DIFFERENT_REPLAY);
  }
  return true;
}

/** A program's cycle 1 plan row, or undefined if it has none. */
async function cycleOne(
  db: Executor,
  user: UserId,
  programId: string,
): Promise<
  { id: string; name: string | null; notes: string | null } | undefined
> {
  const [plan] = await db
    .select({
      id: workoutPlans.id,
      name: workoutPlans.name,
      notes: workoutPlans.notes,
    })
    .from(workoutPlans)
    .where(
      and(
        userScope(user).workoutPlans,
        eq(workoutPlans.programId, programId),
        eq(workoutPlans.cycleNumber, 1),
      ),
    );
  return plan;
}

/** The fingerprint of a program's stored cycle 1, or undefined if it has none. */
async function cycleOneFingerprint(
  db: Executor,
  user: UserId,
  programId: string,
): Promise<string | undefined> {
  const plan = await cycleOne(db, user, programId);
  return plan ? storedCycleFingerprint(db, user, plan.id) : undefined;
}

// --- Reads (D10) ---------------------------------------------------------------

/**
 * Every program the user owns, whatever its status, with its length and
 * current cycle (GET /programs). Two queries however many programs.
 */
export async function listPrograms(
  db: Db,
  user: UserId,
): Promise<ProgramListResponse> {
  return { programs: await programSummaries(db, user) };
}

/**
 * The program and its cycles, each flagged trained if any of its workouts has
 * a session of any status, and fullyTrained if all of them do (GET
 * /programs/:id). One query for the flags however many cycles.
 */
export async function getProgram(
  db: Db,
  user: UserId,
  programId: string,
): Promise<ProgramDetailResponse> {
  const scope = userScope(user);
  const program = await programSummary(db, user, programId);
  const plans = await db
    .select({ id: workoutPlans.id, cycleNumber: workoutPlans.cycleNumber })
    .from(workoutPlans)
    .where(and(scope.workoutPlans, eq(workoutPlans.programId, programId)))
    .orderBy(asc(workoutPlans.cycleNumber));
  // One grouped query for both flags: a workout counts once however many
  // sessions it has, and the left join keeps untrained workouts in the total.
  const progress =
    plans.length === 0
      ? []
      : await db
          .select({
            planId: workouts.planId,
            total: sql<number>`count(distinct ${workouts.id})::int`,
            sessioned: sql<number>`count(distinct ${workoutSessions.workoutId})::int`,
          })
          .from(workouts)
          .leftJoin(
            workoutSessions,
            and(
              eq(workoutSessions.workoutId, workouts.id),
              scope.workoutSessions,
            ),
          )
          .where(
            and(
              scope.workouts,
              inArray(
                workouts.planId,
                plans.map((p) => p.id),
              ),
            ),
          )
          .groupBy(workouts.planId);
  const byPlan = new Map(progress.map((r) => [r.planId, r]));
  return {
    program,
    cycles: plans.map((p) => {
      const r = byPlan.get(p.id);
      return {
        cycleNumber: p.cycleNumber,
        trained: (r?.sessioned ?? 0) > 0,
        fullyTrained: r !== undefined && r.total > 0 && r.sessioned === r.total,
      };
    }),
  };
}

// --- Lifecycle (3.9-3.12, D8) ----------------------------------------------------

/**
 * Copies a program into a new, independent DRAFT (POST /programs/:id/copy;
 * operations.md 3.9) through create's path (D3): the program row
 * (`insertProgramRow`) with the source's notes and length, the source's
 * cycle 1 cloned as cycle 1, then `fillCycles` to the source's length.
 * Nothing is shared with the source. The name (`input.name`, else the
 * source's) is auto-suffixed "Name (2)", "Name (3)"... when taken.
 *
 * Idempotent on `newProgramId` with create's replay rule (`isReplay`, design
 * D17): an existing program under that id is the copy only if its name is
 * the requested one or a suffix of it, its length is the source's and its
 * cycle 1 fingerprints as the source's; any difference is a `conflict`.
 */
export async function copyProgram(
  db: Db,
  user: UserId,
  sourceProgramId: string,
  input: CopyProgramRequest,
): Promise<ProgramResponse> {
  return transact(db, async (tx) => {
    const source = await lockProgram(tx, user, sourceProgramId);
    if (input.newProgramId === sourceProgramId) {
      throw conflict(PROGRAM_ID_TAKEN);
    }
    const sourceCycle = await cycleOne(tx, user, sourceProgramId);
    if (!sourceCycle) {
      throw invalid(`"${source.name}" has no first cycle to copy.`);
    }
    const name = input.name ?? source.name;
    const fingerprint = await storedCycleFingerprint(tx, user, sourceCycle.id);
    const replay = () =>
      isReplay(
        tx,
        user,
        {
          programId: input.newProgramId,
          name,
          targetCycles: source.targetCycles,
          fingerprint,
        },
        "free",
      );

    const summary = async () => ({
      program: await programSummary(tx, user, input.newProgramId),
    });
    if (await replay()) return summary();

    const inserted = await insertProgramRow(
      tx,
      user,
      {
        id: input.newProgramId,
        name: await programNameFor(tx, user, name, "free"),
        notes: source.notes,
        targetCycles: source.targetCycles,
      },
      replay,
    );
    if (!inserted) return summary();
    const cycle1PlanId = newId();
    await clonePlan(tx, user, {
      sourcePlanId: sourceCycle.id,
      target: {
        programId: input.newProgramId,
        newPlanId: cycle1PlanId,
        cycleNumber: 1,
        name: sourceCycle.name,
        notes: sourceCycle.notes,
      },
    });
    await fillCycles(
      tx,
      user,
      input.newProgramId,
      cycle1PlanId,
      source.targetCycles,
    );
    return summary();
  });
}

/**
 * Activates a DRAFT or ARCHIVED program (POST /programs/:id/activate;
 * operations.md 3.10). Changes that program and nothing else: any number may
 * be ACTIVE. Already ACTIVE is a no-op. A COMPLETED program runs again only by
 * extending it (3.12).
 *
 * In the same transaction it runs the finish's exhaustion check
 * (`advanceProgram`), so an ACTIVE program always has something next: an
 * open-ended program whose workouts were all resolved while it was archived
 * gains its next cycle, and such a fixed program becomes COMPLETED (design D8,
 * gap a).
 */
export async function activateProgram(
  db: Db,
  user: UserId,
  programId: string,
): Promise<ProgramResponse> {
  return transact(db, async (tx) => {
    const program = await lockProgram(tx, user, programId);
    if (program.status === "COMPLETED") {
      throw invalid(
        `"${program.name}" is finished. Add a cycle to run it again.`,
      );
    }
    if (program.status !== "ACTIVE") {
      await setStatus(tx, user, programId, "ACTIVE");
      await advanceProgram(tx, user, programId);
    }
    return { program: await programSummary(tx, user, programId) };
  });
}

/**
 * Archives a program (POST /programs/:id/archive; operations.md 3.11): how a
 * program stops. Never COMPLETED -- that is written only when the last cycle
 * is trained (4.13). History stays. Already ARCHIVED is a no-op.
 */
export async function archiveProgram(
  db: Db,
  user: UserId,
  programId: string,
): Promise<ProgramResponse> {
  return transact(db, async (tx) => {
    const program = await lockProgram(tx, user, programId);
    if (program.status !== "ARCHIVED") {
      await setStatus(tx, user, programId, "ARCHIVED");
    }
    return { program: await programSummary(tx, user, programId) };
  });
}

/**
 * Renames a program (PATCH /programs/:id). An exact clash with another of the
 * user's programs is refused, naming it (D9). The same name is a no-op.
 */
export async function renameProgram(
  db: Db,
  user: UserId,
  programId: string,
  input: RenameProgramRequest,
): Promise<ProgramResponse> {
  return transact(db, async (tx) => {
    const program = await lockProgram(tx, user, programId);
    if (program.name !== input.name) {
      await assertProgramNameFree(tx, user, input.name, programId);
      await tx
        .update(workoutPrograms)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(
            userScope(user).workoutPrograms,
            eq(workoutPrograms.id, programId),
          ),
        );
    }
    return { program: await programSummary(tx, user, programId) };
  });
}

/**
 * Runs a fixed-length program for one more cycle (POST /programs/:id/extend;
 * operations.md 3.12): `appendCycle` clones the highest-numbered cycle as
 * `newPlanId`,
 * increments `target_cycles` and sets the program ACTIVE, in one transaction.
 * Idempotent on `newPlanId`: a replay finds that plan in this program and
 * writes nothing. Open-ended programs extend themselves (4.13) and are
 * refused.
 */
export async function extendProgram(
  db: Db,
  user: UserId,
  programId: string,
  input: ExtendProgramRequest,
): Promise<ProgramResponse> {
  return transact(db, async (tx) => {
    const program = await lockProgram(tx, user, programId);
    const scope = userScope(user);
    const [replay] = await tx
      .select({ programId: workoutPlans.programId })
      .from(workoutPlans)
      .where(and(scope.workoutPlans, eq(workoutPlans.id, input.newPlanId)));
    if (replay) {
      if (replay.programId !== programId) {
        throw conflict("That cycle id is already in use.");
      }
      return { program: await programSummary(tx, user, programId) };
    }
    if (program.targetCycles === null) {
      throw invalid(
        `"${program.name}" is open-ended: it adds its next cycle by itself.`,
      );
    }

    if (program.targetCycles >= programLimits.maxExtendedCycles) {
      throw invalid(
        `"${program.name}" already runs ${program.targetCycles} cycles, the most a program can. Start a new program to keep going.`,
      );
    }

    if (!(await appendCycle(tx, user, programId, input.newPlanId))) {
      throw invalid(`"${program.name}" has no cycle to repeat.`);
    }
    await tx
      .update(workoutPrograms)
      .set({
        targetCycles: program.targetCycles + 1,
        status: "ACTIVE",
        updatedAt: new Date(),
      })
      .where(and(scope.workoutPrograms, eq(workoutPrograms.id, programId)));
    return { program: await programSummary(tx, user, programId) };
  });
}

/** Sets a program's status. The caller holds the program lock or created it. */
export async function setStatus(
  tx: Tx,
  user: UserId,
  programId: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<void> {
  await tx
    .update(workoutPrograms)
    .set({ status, updatedAt: new Date() })
    .where(
      and(userScope(user).workoutPrograms, eq(workoutPrograms.id, programId)),
    );
}
