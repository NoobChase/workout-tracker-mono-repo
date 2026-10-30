// Training a session: the offline operations (operations.md 0.3) -- start
// (4.2), log (4.3-4.4), edit (4.15), delete (4.16), finish (4.13) and skip the
// whole workout (4.14). Each is one transaction, and each is safe to replay:
// the queue delivers at least once.
//
// Client-minted ids are inserted `ON CONFLICT (id) DO NOTHING` and then
// re-read through `userScope`, so an id that collides with another user's row
// is a conflict rather than a silent "success" (packages/db/CLAUDE.md).
import { and, eq, ne, notExists, sql } from "drizzle-orm";
import {
  assertExercisesUsable,
  assertOwned,
  plannedExercises,
  sessionExercises,
  sessionSets,
  userExerciseSettings,
  userScope,
  users,
  workoutPlans,
  workoutSessions,
  workouts,
  type Db,
  type Tx,
  type UserId,
} from "@workout-tracker/db";
import type {
  EditSetRequest,
  FinishWorkoutResponse,
  LogSetRequest,
  SkippedSession,
  SkipWorkoutInput,
  StartWorkoutRequest,
  WeightUnit,
} from "@workout-tracker/shared";
import { conflict, invalid, notFound, transact } from "./errors";
import { advanceProgram, lockProgram } from "./plan";
import { loggedSetColumns, toIso, toLoggedSet, type LoggedSet } from "./rows";

export interface StartedSession {
  id: string;
  workoutId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  performedAt: string;
}

/**
 * Starts `workoutId` as session `sessionId` (PUT /sessions/:id). Writes one
 * `workout_sessions` row and nothing else (operations.md 4.2). A replay
 * returns the stored session unchanged.
 */
export async function startWorkout(
  db: Db,
  user: UserId,
  sessionId: string,
  input: StartWorkoutRequest,
): Promise<StartedSession> {
  return transact(db, async (tx) => {
    await assertOwned(tx, user, "workouts", [input.workoutId]);
    await tx
      .insert(workoutSessions)
      .values({
        id: sessionId,
        userId: user,
        workoutId: input.workoutId,
        performedAt: new Date(input.performedAt),
        status: "IN_PROGRESS",
      })
      .onConflictDoNothing({ target: workoutSessions.id });

    const [row] = await tx
      .select({
        id: workoutSessions.id,
        workoutId: workoutSessions.workoutId,
        status: workoutSessions.status,
        performedAt: workoutSessions.performedAt,
      })
      .from(workoutSessions)
      .where(
        and(userScope(user).workoutSessions, eq(workoutSessions.id, sessionId)),
      );
    if (row?.workoutId !== input.workoutId) {
      throw conflict("That session id is already in use.");
    }
    return {
      id: row.id,
      workoutId: row.workoutId,
      status: row.status,
      performedAt: toIso(row.performedAt),
    };
  });
}

/**
 * Logs set `setId` (PUT /sets/:id; design D5). On first contact with an
 * exercise the request's session exercise is inserted too, in the same
 * transaction (operations.md 4.3). The unit is the device's, else the
 * per-exercise override, else the user's default. A replay returns the stored
 * set, even after it has been edited or renumbered.
 */
export async function logSet(
  db: Db,
  user: UserId,
  setId: string,
  input: LogSetRequest,
): Promise<LoggedSet> {
  const se = input.sessionExercise;
  const scope = userScope(user);
  return transact(db, async (tx) => {
    const replay = await readSet(tx, user, setId);
    if (replay) return sameParentOrConflict(replay, se.id);

    const [session] = await tx
      .select({
        status: workoutSessions.status,
        workoutId: workoutSessions.workoutId,
      })
      .from(workoutSessions)
      .where(and(scope.workoutSessions, eq(workoutSessions.id, se.sessionId)));
    if (!session) throw notFound("That workout session doesn't exist.");
    if (session.status !== "IN_PROGRESS") {
      throw invalid("This workout is already finished; sets can't be added.");
    }

    await assertExercisesUsable(tx, user, [se.exerciseId]);
    if (se.plannedExerciseId !== null) {
      const [planned] = await tx
        .select({ workoutId: plannedExercises.workoutId })
        .from(plannedExercises)
        .where(
          and(
            scope.plannedExercises,
            eq(plannedExercises.id, se.plannedExerciseId),
          ),
        );
      if (!planned) throw notFound("That exercise isn't in your plan.");
      if (planned.workoutId !== session.workoutId) {
        throw invalid("That exercise isn't part of this workout.");
      }
    }

    await tx
      .insert(sessionExercises)
      .values({
        id: se.id,
        sessionId: se.sessionId,
        exerciseId: se.exerciseId,
        plannedExerciseId: se.plannedExerciseId,
        position: se.position,
      })
      .onConflictDoNothing({ target: sessionExercises.id });
    const [parent] = await tx
      .select({
        sessionId: sessionExercises.sessionId,
        exerciseId: sessionExercises.exerciseId,
        plannedExerciseId: sessionExercises.plannedExerciseId,
      })
      .from(sessionExercises)
      .where(and(scope.sessionExercises, eq(sessionExercises.id, se.id)));
    if (
      parent?.sessionId !== se.sessionId ||
      parent.exerciseId !== se.exerciseId ||
      parent.plannedExerciseId !== se.plannedExerciseId
    ) {
      throw conflict("That exercise entry belongs to a different workout.");
    }

    // The set-number unique is deferred to COMMIT; check here so a clash is
    // a clear conflict (and the commit-time check stays a backstop).
    const [clash] = await tx
      .select({ id: sessionSets.id })
      .from(sessionSets)
      .where(
        and(
          scope.sessionSets,
          eq(sessionSets.sessionExerciseId, se.id),
          eq(sessionSets.setNumber, input.setNumber),
        ),
      );
    if (clash) {
      // A concurrent delivery of this same set committed while we waited.
      if (clash.id === setId) return (await readSet(tx, user, setId))!;
      throw conflict(
        `Set ${input.setNumber} is already logged for this exercise.`,
      );
    }

    const unit =
      input.weightUnit ?? (await resolveUnit(tx, user, se.exerciseId));
    const inserted = await tx
      .insert(sessionSets)
      .values({
        id: setId,
        sessionExerciseId: se.id,
        setNumber: input.setNumber,
        reps: input.reps,
        weight: String(input.weight),
        weightUnit: unit,
        kind: "NORMAL",
        loggedAt: new Date(input.loggedAt),
      })
      .onConflictDoNothing({ target: sessionSets.id })
      .returning(loggedSetColumns);
    if (inserted[0]) return toLoggedSet(inserted[0]);

    const raced = await readSet(tx, user, setId);
    if (!raced) throw conflict("That set id is already in use.");
    return sameParentOrConflict(raced, se.id);
  });
}

/**
 * Corrects a logged set's reps and weight (PATCH /sets/:id; operations.md
 * 4.15). Absolute values, so a replay writes the same row. No unit keeps the
 * stamped one. A set the user does not own -- missing or someone else's --
 * is `not_found`: an edit of a set that does not exist is a client bug.
 */
export async function editSet(
  db: Db,
  user: UserId,
  setId: string,
  input: EditSetRequest,
): Promise<LoggedSet> {
  return transact(db, async (tx) => {
    const [row] = await tx
      .update(sessionSets)
      .set({
        reps: input.reps,
        weight: String(input.weight),
        ...(input.weightUnit ? { weightUnit: input.weightUnit } : {}),
      })
      .where(and(userScope(user).sessionSets, eq(sessionSets.id, setId)))
      .returning(loggedSetColumns);
    if (!row) throw notFound("That set doesn't exist.");
    return toLoggedSet(row);
  });
}

/**
 * Deletes a logged set (DELETE /sets/:id; operations.md 4.16): removes it,
 * renumbers its exercise's survivors 1..n in their order, and removes the
 * session exercise if that was its last set (design D6), in one transaction.
 * Idempotent by outcome: an id the user does not own -- already deleted, or
 * never theirs -- changes nothing and succeeds.
 */
export async function deleteSet(
  db: Db,
  user: UserId,
  setId: string,
): Promise<void> {
  const scope = userScope(user);
  await transact(db, async (tx) => {
    // Lock the parent so two deliveries for one exercise serialize.
    const [parent] = await tx
      .select({ id: sessionExercises.id })
      .from(sessionSets)
      .innerJoin(
        sessionExercises,
        eq(sessionExercises.id, sessionSets.sessionExerciseId),
      )
      .where(and(scope.sessionSets, eq(sessionSets.id, setId)))
      .for("update", { of: sessionExercises });
    if (!parent) return;

    await tx
      .delete(sessionSets)
      .where(and(scope.sessionSets, eq(sessionSets.id, setId)));

    // Survivors renumbered by their existing order. The set-number unique is
    // DEFERRABLE INITIALLY DEFERRED, so only the final state is checked.
    await tx.execute(sql`
      UPDATE ${sessionSets} SET set_number = r.n
      FROM (
        SELECT ${sessionSets.id} AS id,
               row_number() OVER (ORDER BY ${sessionSets.setNumber}) AS n
        FROM ${sessionSets}
        WHERE ${eq(sessionSets.sessionExerciseId, parent.id)}
      ) r
      WHERE ${sessionSets.id} = r.id
        AND ${sessionSets.setNumber} <> r.n
        AND ${scope.sessionSets}`);

    // Its last set is gone: "skipped = no row" (operations.md 4.7) holds again.
    await tx.delete(sessionExercises).where(
      and(
        scope.sessionExercises,
        eq(sessionExercises.id, parent.id),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(sessionSets)
            .where(eq(sessionSets.sessionExerciseId, sessionExercises.id)),
        ),
      ),
    );
  });
}

/**
 * Finishes a session (POST /sessions/:id/finish; operations.md 4.13, design
 * D4). The status change is guarded on IN_PROGRESS, and only a call that
 * changed the row evaluates program exhaustion -- so a replay, or a second
 * concurrent delivery (blocked on the row lock, then finding it COMPLETED),
 * adds nothing. `extended` is true only on the call that added a cycle.
 */
export async function finishWorkout(
  db: Db,
  user: UserId,
  sessionId: string,
): Promise<FinishWorkoutResponse> {
  const scope = userScope(user);
  return transact(db, async (tx) => {
    const [finished] = await tx
      .update(workoutSessions)
      .set({ status: "COMPLETED" })
      .where(
        and(
          scope.workoutSessions,
          eq(workoutSessions.id, sessionId),
          eq(workoutSessions.status, "IN_PROGRESS"),
        ),
      )
      .returning({ workoutId: workoutSessions.workoutId });

    if (!finished) {
      const [s] = await tx
        .select({ status: workoutSessions.status })
        .from(workoutSessions)
        .where(and(scope.workoutSessions, eq(workoutSessions.id, sessionId)));
      if (!s) throw notFound("That workout session doesn't exist.");
      if (s.status === "SKIPPED") {
        throw invalid("This workout was skipped, so it can't be finished.");
      }
      return { sessionId, status: "COMPLETED", extended: false };
    }

    // The roll-over (operations.md 4.13) for the program the workout belongs
    // to, under the program lock.
    const programId =
      finished.workoutId === null
        ? undefined
        : await programOfWorkout(tx, user, finished.workoutId);
    const extended =
      programId !== undefined && (await advanceProgram(tx, user, programId));
    return { sessionId, status: "COMPLETED", extended };
  });
}

/**
 * Skips a whole workout before it starts (POST /workouts/:id/skip;
 * operations.md 4.14; design D15 of step-4a). Writes one SKIPPED
 * `workout_sessions` row with the client-minted `sessionId` and nothing else,
 * then runs the finish's roll-over under the same program lock, so skipping
 * a cycle's last workout extends an open-ended program or completes a fixed
 * one exactly as finishing it would.
 *
 * Refused (`conflict`, naming the workout) when the workout already has any
 * session: a started one is finished, not skipped, and a resolved one needs
 * no skip. A replay -- the same id for the same workout -- returns the stored
 * session and writes nothing; the id anywhere else is a `conflict`.
 *
 * Locks the program, then the workout, in saveCycle's order. A start inserts
 * its session under a key-share lock on the workout, so holding the workout
 * `FOR UPDATE` makes "no other session" stay true until COMMIT.
 */
export async function skipWorkout(
  db: Db,
  user: UserId,
  input: SkipWorkoutInput,
): Promise<SkippedSession> {
  const scope = userScope(user);
  return transact(db, async (tx) => {
    const programId = await programOfWorkout(tx, user, input.workoutId);
    if (!programId) throw notFound("That workout doesn't exist.");
    await lockProgram(tx, user, programId);
    const [workout] = await tx
      .select({ name: workouts.name })
      .from(workouts)
      .where(and(scope.workouts, eq(workouts.id, input.workoutId)))
      .for("update");
    if (!workout) throw notFound("That workout doesn't exist.");

    const [other] = await tx
      .select({ status: workoutSessions.status })
      .from(workoutSessions)
      .where(
        and(
          scope.workoutSessions,
          eq(workoutSessions.workoutId, input.workoutId),
          ne(workoutSessions.id, input.sessionId),
        ),
      )
      .limit(1);
    if (other) throw conflict(alreadyHasSession(workout.name, other.status));

    const inserted = await tx
      .insert(workoutSessions)
      .values({
        id: input.sessionId,
        userId: user,
        workoutId: input.workoutId,
        performedAt: new Date(input.performedAt),
        status: "SKIPPED",
      })
      .onConflictDoNothing({ target: workoutSessions.id })
      .returning({ id: workoutSessions.id });

    const [row] = await tx
      .select({
        id: workoutSessions.id,
        workoutId: workoutSessions.workoutId,
        status: workoutSessions.status,
        performedAt: workoutSessions.performedAt,
      })
      .from(workoutSessions)
      .where(
        and(scope.workoutSessions, eq(workoutSessions.id, input.sessionId)),
      );
    if (row?.workoutId !== input.workoutId) {
      throw conflict("That session id is already in use.");
    }
    if (row.status !== "SKIPPED") {
      throw conflict(alreadyHasSession(workout.name, row.status));
    }

    // Only the call that wrote the row rolls the program over: a replay adds
    // nothing, as a replayed finish adds nothing.
    if (inserted.length > 0) await advanceProgram(tx, user, programId);
    return {
      id: row.id,
      workoutId: row.workoutId,
      status: row.status,
      performedAt: toIso(row.performedAt),
    };
  });
}

function alreadyHasSession(
  workoutName: string,
  status: "IN_PROGRESS" | "COMPLETED" | "SKIPPED",
): string {
  switch (status) {
    case "IN_PROGRESS":
      return `${workoutName} is already started, so it can't be skipped. Finish it instead.`;
    case "COMPLETED":
      return `${workoutName} is already done, so it can't be skipped.`;
    case "SKIPPED":
      return `${workoutName} is already skipped.`;
  }
}

/** The program a workout belongs to, or undefined if it is not the user's. */
async function programOfWorkout(
  tx: Tx,
  user: UserId,
  workoutId: string,
): Promise<string | undefined> {
  const [owner] = await tx
    .select({ programId: workoutPlans.programId })
    .from(workouts)
    .innerJoin(workoutPlans, eq(workoutPlans.id, workouts.planId))
    .where(and(userScope(user).workouts, eq(workouts.id, workoutId)));
  return owner?.programId;
}

/** A set this user owns, or undefined. */
async function readSet(tx: Tx, user: UserId, setId: string) {
  const [row] = await tx
    .select(loggedSetColumns)
    .from(sessionSets)
    .where(and(userScope(user).sessionSets, eq(sessionSets.id, setId)));
  return row ? toLoggedSet(row) : undefined;
}

/**
 * A log-set replay matches on its parent only: by the time it is redelivered
 * the set may have been edited, or renumbered by a delete, and neither makes
 * it a different set.
 */
function sameParentOrConflict(
  set: LoggedSet,
  sessionExerciseId: string,
): LoggedSet {
  if (set.sessionExerciseId !== sessionExerciseId) {
    throw conflict("That set id is already in use.");
  }
  return set;
}

/**
 * The server's fallback when the device sent no unit (operations.md 4.3):
 * the per-exercise override, else the user's default.
 */
async function resolveUnit(
  tx: Tx,
  user: UserId,
  exerciseId: string,
): Promise<WeightUnit> {
  const [row] = await tx
    .select({
      unit: sql<WeightUnit>`COALESCE(${userExerciseSettings.defaultWeightUnit}, ${users.defaultWeightUnit})`,
    })
    .from(users)
    .leftJoin(
      userExerciseSettings,
      and(
        userScope(user).userExerciseSettings,
        eq(userExerciseSettings.exerciseId, exerciseId),
      ),
    )
    .where(eq(users.id, user));
  if (!row) throw notFound("Your account doesn't exist.");
  return row.unit;
}
