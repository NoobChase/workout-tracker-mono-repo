// Cycle trees for the builder tests: built as a client would (ids minted with
// `newId`, parsed through the `packages/shared` contract), plus readers that
// look at what landed in the database.
import {
  catalog,
  storedCycleFingerprints,
  type UserId,
} from "@workout-tracker/db";
import {
  cycleTree,
  plannedExerciseNode,
  saveCycleRequest,
  workoutNode,
  type CreateProgramRequest,
  type CycleTree,
  type PlannedExerciseNode,
  type SaveCycleResponse,
  type WorkoutNode,
} from "@workout-tracker/shared";
import {
  createProgram,
  getApplyPreview,
  getCycle,
  saveCycle,
} from "../src/index";
import { db, newId, pool, type ProgramFixture } from "./db";

/** A standard exercise's id, by its catalog name. */
export function ex(name: string): string {
  const found = catalog.find((e) => e.name === name);
  if (!found) throw new Error(`no catalog exercise named ${name}`);
  return found.id;
}

type SetSpec = Partial<
  Omit<PlannedExerciseNode["plannedSets"][number], "id" | "setNumber">
>;

export interface SlotSpec {
  exercise?: string;
  label?: string;
  sets?: number;
  prescribed?: SetSpec[];
  group?: number;
  notes?: string;
}

/** A slot at `position`: an exercise by catalog name, or a placeholder label. */
export function slot(position: number, spec: SlotSpec): PlannedExerciseNode {
  return plannedExerciseNode.parse({
    id: newId(),
    exerciseId: spec.exercise ? ex(spec.exercise) : null,
    placeholderLabel: spec.label ?? null,
    position,
    targetSets: spec.sets ?? 3,
    groupKey: spec.group ?? null,
    notes: spec.notes ?? null,
    plannedSets: (spec.prescribed ?? []).map((s, i) => ({
      id: newId(),
      setNumber: i + 1,
      ...s,
    })),
  });
}

export function workout(
  position: number,
  name: string,
  slots: SlotSpec[],
  notes: string | null = null,
): WorkoutNode {
  return workoutNode.parse({
    id: newId(),
    name,
    position,
    notes,
    plannedExercises: slots.map((s, i) => slot(i, s)),
  });
}

export function cycle(workouts: WorkoutNode[]): CycleTree {
  return cycleTree.parse({ id: newId(), workouts });
}

const at = (weight: number) => ({
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetWeight: weight,
  weightUnit: "LB" as const,
});

/** Push / Pull / Legs, small enough that a 12-cycle program is cheap. */
export function ppl(): CycleTree {
  return cycle([
    workout(0, "Push", [
      {
        exercise: "Barbell Bench Press",
        sets: 3,
        prescribed: [at(135), at(135)],
      },
    ]),
    workout(1, "Pull", [{ exercise: "Barbell Row", sets: 3 }]),
    workout(2, "Legs", [
      { exercise: "Back Squat", sets: 3, prescribed: [at(185)] },
    ]),
  ]);
}

/** Creates a program and returns its id and the cycle-1 tree it was built from. */
export async function create(
  user: UserId,
  options: Partial<Omit<CreateProgramRequest, "programId">> = {},
) {
  const input: CreateProgramRequest = {
    programId: newId(),
    name: options.name ?? `Program ${newId().slice(-6)}`,
    targetCycles: options.targetCycles === undefined ? 4 : options.targetCycles,
    cycle: options.cycle ?? ppl(),
  };
  const response = await createProgram(db, user, input);
  return { programId: input.programId, input, response };
}

/** Cycle n as the builder reads it, trained flags and dates stripped: ready to edit. */
export async function editable(
  user: UserId,
  programId: string,
  n: number,
): Promise<CycleTree> {
  const { cycle: c } = await getCycle(db, user, programId, n);
  return {
    id: c.id,
    workouts: c.workouts.map(({ trained: _, trainedAt: __, ...w }) => w),
  };
}

/**
 * The builder's save flow: preview, edit, save with `expected` taken from the
 * preview. `edit` mutates the tree in place. `between` runs after the preview
 * and before the save (something else happening meanwhile).
 */
export async function save(
  user: UserId,
  programId: string,
  n: number,
  edit: (c: CycleTree) => void,
  applyTo: number[] = [],
  between?: () => Promise<void>,
): Promise<{
  response: SaveCycleResponse;
  request: ReturnType<typeof saveCycleRequest.parse>;
}> {
  const preview = await getApplyPreview(db, user, programId, n);
  const c = await editable(user, programId, n);
  edit(c);
  const request = saveRequest(preview, c, applyTo);
  await between?.();
  return {
    response: await saveCycle(db, user, programId, n, request),
    request,
  };
}

export function saveRequest(
  preview: Awaited<ReturnType<typeof getApplyPreview>>,
  c: CycleTree,
  applyTo: number[],
) {
  return saveCycleRequest.parse({
    cycle: c,
    expected: { source: preview.source },
    applyTo: applyTo.map((k) => ({
      cycleNumber: k,
      fingerprint: preview.later.find((l) => l.cycleNumber === k)!.fingerprint,
    })),
  });
}

/** Every cycle's fingerprint, by cycle number (index 0 = cycle 1). */
export async function fingerprints(
  user: UserId,
  programId: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM workout_plans WHERE program_id = $1 ORDER BY cycle_number",
    [programId],
  );
  const map = await storedCycleFingerprints(
    db,
    user,
    rows.map((r) => r.id),
  );
  return rows.map((r) => map.get(r.id)!);
}

/** id -> xmin for the program row and every plan row under it. */
export async function xmins(
  programId: string,
): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ id: string; x: string }>(
    `SELECT id, xmin::text AS x FROM workout_programs WHERE id = $1
     UNION ALL SELECT p.id, p.xmin::text FROM workout_plans p WHERE p.program_id = $1
     UNION ALL SELECT w.id, w.xmin::text FROM workouts w
       JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1
     UNION ALL SELECT pe.id, pe.xmin::text FROM planned_exercises pe
       JOIN workouts w ON w.id = pe.workout_id
       JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1
     UNION ALL SELECT ps.id, ps.xmin::text FROM planned_sets ps
       JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
       JOIN workouts w ON w.id = pe.workout_id
       JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1`,
    [programId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.x]));
}

/** Cycle n's workouts as `Training` fixtures (exercise slots only). */
export async function fixtures(
  user: UserId,
  programId: string,
  n: number,
): Promise<ProgramFixture["workouts"]> {
  const { cycle: c } = await getCycle(db, user, programId, n);
  return c.workouts.map((w) => ({
    id: w.id,
    name: w.name,
    exercises: w.plannedExercises.flatMap((s) =>
      s.exerciseId
        ? [{ id: s.id, exerciseId: s.exerciseId, targetSets: s.targetSets }]
        : [],
    ),
  }));
}

/** Every row a program owns, level by level. */
export async function treeCounts(programId: string) {
  const q = async (sql: string) => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (${sql}) q`,
      [programId],
    );
    return rows[0]!.n;
  };
  return {
    programs: await q("SELECT 1 FROM workout_programs WHERE id = $1"),
    plans: await q("SELECT 1 FROM workout_plans WHERE program_id = $1"),
    workouts: await q(
      "SELECT 1 FROM workouts w JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1",
    ),
    exercises: await q(
      `SELECT 1 FROM planned_exercises pe JOIN workouts w ON w.id = pe.workout_id
         JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1`,
    ),
    sets: await q(
      `SELECT 1 FROM planned_sets ps JOIN planned_exercises pe ON pe.id = ps.planned_exercise_id
         JOIN workouts w ON w.id = pe.workout_id
         JOIN workout_plans p ON p.id = w.plan_id WHERE p.program_id = $1`,
    ),
  };
}
