// Starter templates (design D2; specs/program-templates). Starting one is
// `createProgram` (operations.md 3.1) for an open-ended program -- one
// materialized cycle, no clone -- followed by activation (3.10), all in one
// transaction.
import { and, inArray } from "drizzle-orm";
import {
  TEMPLATES,
  exercises,
  findTemplate,
  userScope,
  type Db,
  type ProgramTemplate,
  type UserId,
} from "@workout-tracker/db";
import {
  newId,
  type CycleTree,
  type ProgramResponse,
  type StartFromTemplateRequest,
  type TemplatesResponse,
} from "@workout-tracker/shared";
import { notFound, transact } from "./errors";
import { programSummary } from "./plan";
import { createProgramInTx, setStatus } from "./programs";

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
): Promise<ProgramResponse> {
  const template = findTemplate(input.templateSlug);
  if (!template) throw notFound("That template doesn't exist.");
  return createProgramFromTemplate(db, user, input.programId, template);
}

/**
 * The transaction behind `startProgramFromTemplate`, taking the template
 * itself. Not exported from the package: it exists so a test can feed it a
 * template that fails partway and prove nothing is left behind.
 *
 * The template becomes a cycle tree and goes through `createProgramInTx`
 * (design D3 of step-4a: one create path), with the name auto-suffixed
 * (D9), and is activated in the same transaction (operations.md 3.10). A
 * replay -- same id, an open-ended program, same cycle 1 -- activates nothing
 * and writes nothing; any other program under the id is a `conflict`.
 */
export async function createProgramFromTemplate(
  db: Db,
  user: UserId,
  programId: string,
  template: ProgramTemplate,
): Promise<ProgramResponse> {
  return transact(db, async (tx) => {
    const { created } = await createProgramInTx(
      tx,
      user,
      {
        programId,
        name: template.name,
        targetCycles: null,
        cycle: templateCycle(template),
      },
      "free",
    );
    // Activate (operations.md 3.10). Never touches another program.
    if (created) await setStatus(tx, user, programId, "ACTIVE");
    return { program: await programSummary(tx, user, programId) };
  });
}

/**
 * Cycle 1 of a template as a cycle tree: a workout per template workout, a
 * slot per entry with its target sets, and one prescribed set per target set
 * carrying the rep range and no weight. Fresh ids each call; a replay is
 * recognised by fingerprint, which ignores ids.
 */
function templateCycle(template: ProgramTemplate): CycleTree {
  return {
    id: newId(),
    workouts: template.workouts.map((w, position) => ({
      id: newId(),
      name: w.name,
      position,
      notes: null,
      plannedExercises: w.exercises.map((e, slot) => ({
        id: newId(),
        exerciseId: e.exerciseId,
        placeholderLabel: null,
        position: slot,
        targetSets: e.targetSets,
        groupKey: null,
        notes: null,
        plannedSets: Array.from({ length: e.targetSets }, (_, i) => ({
          id: newId(),
          setNumber: i + 1,
          targetRepsMin: e.repsMin,
          targetRepsMax: e.repsMax,
          targetWeight: null,
          weightUnit: null,
          targetDurationSeconds: null,
          targetDistance: null,
          distanceUnit: null,
          targetRpe: null,
          targetRir: null,
          notes: null,
        })),
      })),
    })),
  };
}
