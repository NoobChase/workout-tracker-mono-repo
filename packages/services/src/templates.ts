// Starter templates (design D2; specs/program-templates). Starting one is the
// ordinary create-program transaction (operations.md 3.1) for an open-ended
// program -- one materialized cycle, no clone -- followed by activation
// (3.10), all in one transaction.
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  TEMPLATES,
  assertExercisesUsable,
  exercises,
  findTemplate,
  plannedExercises,
  plannedSets,
  userScope,
  workoutPlans,
  workoutPrograms,
  workouts,
  type Db,
  type ProgramTemplate,
  type Tx,
  type UserId,
} from "@workout-tracker/db";
import {
  newId,
  type StartFromTemplateRequest,
  type StartFromTemplateResponse,
  type TemplatesResponse,
} from "@workout-tracker/shared";
import { conflict, notFound, transact } from "./errors";

/** Every default template, with its exercises' names (GET /templates). */
export async function listTemplates(
  db: Db,
  user: UserId,
): Promise<TemplatesResponse> {
  const ids = [
    ...new Set(
      TEMPLATES.flatMap((t) =>
        t.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)),
      ),
    ),
  ];
  const rows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(and(userScope(user).visibleExercises, inArray(exercises.id, ids)));
  const names = new Map(rows.map((r) => [r.id, r.name]));
  return {
    templates: TEMPLATES.map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      workouts: t.workouts.map((w) => ({
        name: w.name,
        exercises: w.exercises.map((e) => {
          const name = names.get(e.exerciseId);
          // templates.test.ts in packages/db pins every id to the catalog,
          // and CI seeds it after every migration; a miss is a deploy fault.
          if (name === undefined) {
            throw new Error(`template exercise ${e.exerciseId} is not seeded`);
          }
          return {
            exerciseId: e.exerciseId,
            name,
            targetSets: e.targetSets,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
          };
        }),
      })),
    })),
  };
}

/**
 * Starts a template as an ACTIVE, open-ended program owned by `user`
 * (POST /templates/start). Idempotent on the client-minted `programId`: a
 * replay returns the program the first call created and writes nothing. An id
 * that is already another user's program is a conflict, never a success.
 */
export async function startProgramFromTemplate(
  db: Db,
  user: UserId,
  input: StartFromTemplateRequest,
): Promise<StartFromTemplateResponse> {
  const template = findTemplate(input.templateSlug);
  if (!template) throw notFound("That template doesn't exist.");
  return createProgramFromTemplate(db, user, input.programId, template);
}

/**
 * The transaction behind `startProgramFromTemplate`, taking the template
 * itself. Not exported from the package: it exists so a test can feed it a
 * template that fails partway and prove nothing is left behind.
 */
export async function createProgramFromTemplate(
  db: Db,
  user: UserId,
  programId: string,
  template: ProgramTemplate,
): Promise<StartFromTemplateResponse> {
  return transact(db, async (tx) => {
    const existing = await readProgram(tx, user, programId);
    if (existing) return { program: existing };

    const name = await freeProgramName(tx, user, template.name);
    const inserted = await tx
      .insert(workoutPrograms)
      .values({
        id: programId,
        userId: user,
        name,
        status: "DRAFT",
        targetCycles: null,
        startDate: sql`CURRENT_DATE`,
      })
      .onConflictDoNothing({ target: workoutPrograms.id })
      .returning({ id: workoutPrograms.id });
    if (inserted.length === 0) {
      // Taken between the read above and the insert: a concurrent replay of
      // this same start (its row is now visible), or another user's id.
      const raced = await readProgram(tx, user, programId);
      if (raced) return { program: raced };
      throw conflict("That program id is already in use.");
    }

    await materializeCycle(tx, user, programId, template);

    // Activate (operations.md 3.10). Never touches another program.
    await tx
      .update(workoutPrograms)
      .set({ status: "ACTIVE" })
      .where(
        and(userScope(user).workoutPrograms, eq(workoutPrograms.id, programId)),
      );

    const created = await readProgram(tx, user, programId);
    if (!created) throw new Error("created program is not readable");
    return { program: created };
  });
}

async function readProgram(tx: Tx, user: UserId, programId: string) {
  const [row] = await tx
    .select({
      id: workoutPrograms.id,
      name: workoutPrograms.name,
      status: workoutPrograms.status,
      targetCycles: workoutPrograms.targetCycles,
    })
    .from(workoutPrograms)
    .where(
      and(userScope(user).workoutPrograms, eq(workoutPrograms.id, programId)),
    );
  if (!row) return undefined;
  // A template program is open-ended; a fixed one under this id is not what
  // the client asked to create.
  if (row.targetCycles !== null) {
    throw conflict("That program id is already in use.");
  }
  return { ...row, targetCycles: null };
}

/**
 * The template's name, or the first free "Name (n)" from 2 up -- the same
 * auto-suffix copying a program uses (operations.md 3.9), instead of letting
 * `UNIQUE (user_id, name)` refuse the start.
 */
async function freeProgramName(
  tx: Tx,
  user: UserId,
  base: string,
): Promise<string> {
  const rows = await tx
    .select({ name: workoutPrograms.name })
    .from(workoutPrograms)
    .where(userScope(user).workoutPrograms);
  const taken = new Set(rows.map((r) => r.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Cycle 1: one plan, a workout per template workout, a planned exercise per
 * entry with its target sets, and one planned set per target set carrying the
 * rep range and no weight. Ids are minted before each level is written, so
 * the parent ids are already known -- one insert per level (operations.md
 * 0.2).
 */
async function materializeCycle(
  tx: Tx,
  user: UserId,
  programId: string,
  template: ProgramTemplate,
): Promise<void> {
  await assertExercisesUsable(
    tx,
    user,
    template.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)),
  );

  const planId = newId();
  await tx
    .insert(workoutPlans)
    .values({ id: planId, programId, cycleNumber: 1 });

  const workoutRows = template.workouts.map((w, position) => ({
    id: newId(),
    planId,
    name: w.name,
    position,
  }));
  await tx.insert(workouts).values(workoutRows);

  const exerciseRows = template.workouts.flatMap((w, wi) =>
    w.exercises.map((e, position) => ({
      row: {
        id: newId(),
        workoutId: workoutRows[wi]!.id,
        exerciseId: e.exerciseId,
        position,
        targetSets: e.targetSets,
      },
      entry: e,
    })),
  );
  if (exerciseRows.length === 0) return;
  await tx.insert(plannedExercises).values(exerciseRows.map((e) => e.row));

  const setRows = exerciseRows.flatMap(({ row, entry }) =>
    Array.from({ length: entry.targetSets }, (_, i) => ({
      id: newId(),
      plannedExerciseId: row.id,
      setNumber: i + 1,
      targetRepsMin: entry.repsMin,
      targetRepsMax: entry.repsMax,
    })),
  );
  if (setRows.length > 0) await tx.insert(plannedSets).values(setRows);
}
