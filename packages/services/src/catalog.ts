// The exercise catalog (operations.md 2.1-2.4; design D11 of
// step-4a-program-builder; specs/exercise-catalog). Online-only (0.3).
//
// Who may touch what: `visibleExercises` (standard plus the user's own) for
// reading, referencing and annotating; `ownedExercises` for editing, retiring
// and reactivating. A standard exercise is refused as `invalid` rather than
// `forbidden`: the web app reads every 403 as "not entitled".
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  exerciseMetrics,
  exercises,
  userExerciseSettings,
  userScope,
  type Db,
  type Executor,
  type Tx,
  type UserId,
} from "@workout-tracker/db";
import {
  muscleRuleViolation,
  type CreateExerciseRequest,
  type EditExerciseRequest,
  type ExerciseListItem,
  type ExerciseNotesRequest,
  type ExerciseResponse,
  type ExercisesResponse,
  type ListExercisesQuery,
} from "@workout-tracker/shared";
import { conflict, invalid, notFound, transact } from "./errors";
import { assertExerciseNameFree } from "./names";
import { unitSettings } from "./next";

/**
 * Every exercise the user can see, by name, with metrics and their setup and
 * cues, and the user's weight units (GET /exercises; operations.md 2.1).
 * Active ones only, unless `includeRetired`, which adds the user's own retired exercises -- never a
 * retired standard one. Filtering by muscle, equipment and name is the
 * client's (D11).
 */
export async function listExercises(
  db: Db,
  user: UserId,
  query: ListExercisesQuery,
): Promise<ExercisesResponse> {
  const scope = userScope(user);
  const active = eq(exercises.isActive, true);
  const [list, units] = await Promise.all([
    readExercises(
      db,
      user,
      query.includeRetired ? or(active, scope.ownedExercises)! : active,
    ),
    unitSettings(db, user),
  ]);
  return { exercises: list, units };
}

/**
 * Creates a custom exercise and its metrics in one transaction (POST
 * /exercises; operations.md 2.2). Idempotent on the client-minted `id`: a
 * replay returns the exercise as stored and writes nothing. An id that is a
 * standard exercise's or another user's is a conflict.
 */
export async function createExercise(
  db: Db,
  user: UserId,
  input: CreateExerciseRequest,
): Promise<ExerciseResponse> {
  return transact(db, async (tx) => {
    // The replay check comes first: the exercise holds its own name.
    const replay = await readOwned(tx, user, input.id);
    if (replay) return { exercise: replay };

    await assertExerciseNameFree(tx, user, input.name);
    const inserted = await tx
      .insert(exercises)
      .values({
        id: input.id,
        ownerUserId: user,
        name: input.name,
        primaryMuscles: input.primaryMuscles,
        secondaryMuscles: input.secondaryMuscles,
        equipment: input.equipment,
      })
      .onConflictDoNothing({ target: exercises.id })
      .returning({ id: exercises.id });
    if (inserted.length === 0) {
      // Taken since the read: a concurrent replay of this create (its row is
      // now visible), or an id that was never this user's.
      const raced = await readOwned(tx, user, input.id);
      if (raced) return { exercise: raced };
      throw conflict("That exercise id is already in use.");
    }

    // Only after the insert proved the row is ours: metrics are keyed by
    // exercise, so writing them first could add a metric to someone else's.
    await tx.insert(exerciseMetrics).values(
      input.metrics.map((m) => ({
        exerciseId: input.id,
        metric: m.metric,
        isRequired: m.isRequired,
      })),
    );
    return { exercise: await mustRead(tx, user, input.id) };
  });
}

/**
 * Renames or reclassifies the user's own exercise (PATCH /exercises/:id).
 * Metrics never change. The muscle rules are checked on the row as it will
 * be, so sending only the secondary muscles is judged against the stored
 * primary ones. Values are absolute; a replay changes nothing.
 */
export async function editExercise(
  db: Db,
  user: UserId,
  exerciseId: string,
  input: EditExerciseRequest,
): Promise<ExerciseResponse> {
  return transact(db, async (tx) => {
    const row = await lockOwned(tx, user, exerciseId, "edited");
    const next = {
      name: input.name ?? row.name,
      primaryMuscles: input.primaryMuscles ?? row.primaryMuscles,
      secondaryMuscles: input.secondaryMuscles ?? row.secondaryMuscles,
      equipment:
        input.equipment === undefined ? row.equipment : input.equipment,
    };
    const rule = muscleRuleViolation(
      next.primaryMuscles,
      next.secondaryMuscles,
    );
    if (rule) throw invalid(rule);

    if (next.name !== row.name) {
      await assertExerciseNameFree(tx, user, next.name, exerciseId);
    }
    const changed =
      next.name !== row.name ||
      next.equipment !== row.equipment ||
      !sameList(next.primaryMuscles, row.primaryMuscles) ||
      !sameList(next.secondaryMuscles, row.secondaryMuscles);
    if (changed) {
      await tx
        .update(exercises)
        .set(next)
        .where(
          and(userScope(user).ownedExercises, eq(exercises.id, exerciseId)),
        );
    }
    return { exercise: await mustRead(tx, user, exerciseId) };
  });
}

/**
 * Records setup and cues for any exercise the user can see, standard or
 * their own (PUT /exercises/:id/notes; operations.md 2.3). Upserts the
 * user's settings row on `(user_id, exercise_id)`, writing those two columns
 * only, so `default_weight_unit` (1.3) is never touched. `input.id` is used
 * only when the row is new. A replay with the same text writes nothing.
 */
export async function saveExerciseNotes(
  db: Db,
  user: UserId,
  exerciseId: string,
  input: ExerciseNotesRequest,
): Promise<ExerciseResponse> {
  return transact(db, async (tx) => {
    const [visible] = await tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(userScope(user).visibleExercises, eq(exercises.id, exerciseId)),
      );
    if (!visible) throw notFound("That exercise doesn't exist.");

    await tx
      .insert(userExerciseSettings)
      .values({
        id: input.id,
        userId: user,
        exerciseId,
        setup: input.setup,
        cues: input.cues,
      })
      .onConflictDoUpdate({
        target: [userExerciseSettings.userId, userExerciseSettings.exerciseId],
        set: {
          setup: sql`excluded.setup`,
          cues: sql`excluded.cues`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`(${userExerciseSettings.setup}, ${userExerciseSettings.cues}) IS DISTINCT FROM (excluded.setup, excluded.cues)`,
      });
    return { exercise: await mustRead(tx, user, exerciseId) };
  });
}

/**
 * Retires the user's own exercise (POST /exercises/:id/retire; operations.md
 * 2.4): hidden from the list and pickers, still in plans and history. Never a
 * delete. Retiring a retired exercise writes nothing.
 */
export function retireExercise(
  db: Db,
  user: UserId,
  exerciseId: string,
): Promise<ExerciseResponse> {
  return setActive(db, user, exerciseId, false);
}

/** Brings a retired exercise of the user's back (POST /exercises/:id/reactivate). */
export function reactivateExercise(
  db: Db,
  user: UserId,
  exerciseId: string,
): Promise<ExerciseResponse> {
  return setActive(db, user, exerciseId, true);
}

async function setActive(
  db: Db,
  user: UserId,
  exerciseId: string,
  isActive: boolean,
): Promise<ExerciseResponse> {
  return transact(db, async (tx) => {
    const row = await lockOwned(
      tx,
      user,
      exerciseId,
      isActive ? "reactivated" : "retired",
    );
    if (row.isActive !== isActive) {
      await tx
        .update(exercises)
        .set({ isActive })
        .where(
          and(userScope(user).ownedExercises, eq(exercises.id, exerciseId)),
        );
    }
    return { exercise: await mustRead(tx, user, exerciseId) };
  });
}

/**
 * The user's own exercise, locked for the write. A standard exercise is
 * refused by name of the action; anything else -- another user's, or no
 * such id -- does not exist.
 */
async function lockOwned(
  tx: Tx,
  user: UserId,
  exerciseId: string,
  action: string,
) {
  const scope = userScope(user);
  const [row] = await tx
    .select({
      name: exercises.name,
      primaryMuscles: exercises.primaryMuscles,
      secondaryMuscles: exercises.secondaryMuscles,
      equipment: exercises.equipment,
      isActive: exercises.isActive,
    })
    .from(exercises)
    .where(and(scope.ownedExercises, eq(exercises.id, exerciseId)))
    .for("update");
  if (row) return row;
  const [standard] = await tx
    .select({ name: exercises.name })
    .from(exercises)
    .where(and(scope.visibleExercises, eq(exercises.id, exerciseId)));
  if (standard) {
    throw invalid(
      `${standard.name} is a standard exercise and can't be ${action}.`,
    );
  }
  throw notFound("That exercise doesn't exist.");
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The user's own exercise `id` as a list item, or undefined. */
async function readOwned(
  ex: Executor,
  user: UserId,
  id: string,
): Promise<ExerciseListItem | undefined> {
  const [row] = await readExercises(
    ex,
    user,
    and(userScope(user).ownedExercises, eq(exercises.id, id))!,
  );
  return row;
}

async function mustRead(
  ex: Executor,
  user: UserId,
  id: string,
): Promise<ExerciseListItem> {
  const [row] = await readExercises(ex, user, eq(exercises.id, id));
  if (!row) throw new Error(`exercise ${id} is not readable after its write`);
  return row;
}

/**
 * Visible exercises matching `where`, by name, each with its metrics and the
 * user's setup and cues: two queries whatever the count.
 */
async function readExercises(
  ex: Executor,
  user: UserId,
  where: SQL,
): Promise<ExerciseListItem[]> {
  const scope = userScope(user);
  const rows = await ex
    .select({
      id: exercises.id,
      name: exercises.name,
      ownerUserId: exercises.ownerUserId,
      isActive: exercises.isActive,
      primaryMuscles: exercises.primaryMuscles,
      secondaryMuscles: exercises.secondaryMuscles,
      equipment: exercises.equipment,
      setup: userExerciseSettings.setup,
      cues: userExerciseSettings.cues,
    })
    .from(exercises)
    .leftJoin(
      userExerciseSettings,
      and(
        eq(userExerciseSettings.exerciseId, exercises.id),
        scope.userExerciseSettings,
      ),
    )
    .where(and(scope.visibleExercises, where))
    .orderBy(exercises.name, exercises.id);
  if (rows.length === 0) return [];

  const metrics = await ex
    .select({
      exerciseId: exerciseMetrics.exerciseId,
      metric: exerciseMetrics.metric,
      isRequired: exerciseMetrics.isRequired,
    })
    .from(exerciseMetrics)
    .where(
      inArray(
        exerciseMetrics.exerciseId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(exerciseMetrics.metric);
  const byExercise = new Map<string, typeof metrics>();
  for (const m of metrics) {
    const list = byExercise.get(m.exerciseId) ?? [];
    list.push(m);
    byExercise.set(m.exerciseId, list);
  }

  return rows.map(({ ownerUserId, ...r }) => ({
    ...r,
    isCustom: ownerUserId !== null,
    metrics: (byExercise.get(r.id) ?? []).map((m) => ({
      metric: m.metric,
      isRequired: m.isRequired,
    })),
  }));
}
