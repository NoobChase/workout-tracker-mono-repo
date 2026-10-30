// The exercise catalog's wire contracts (operations.md 2.1-2.4; design D11 of
// openspec/changes/step-4a-program-builder). The enums mirror `packages/db`'s
// pgEnums; `packages/services/test/catalog.test.ts` fails if they drift.
import { z } from "zod";
import { entityId, uuidV7 } from "./ids.js";
import { unitSettings } from "./units.js";

/** Mirrors the `metric_kind` enum: which inputs the logger renders. */
export const metricKind = z.enum([
  "REPS",
  "WEIGHT",
  "DURATION",
  "DISTANCE",
  "COMPLETED",
  "RPE",
]);
export type MetricKind = z.infer<typeof metricKind>;

/** Mirrors the `muscle_group` enum (data-model.md 3.3). */
export const muscleGroup = z.enum([
  "CHEST",
  "LATS",
  "UPPER_BACK",
  "TRAPS",
  "LOWER_BACK",
  "FRONT_DELTS",
  "SIDE_DELTS",
  "REAR_DELTS",
  "BICEPS",
  "TRICEPS",
  "FOREARMS",
  "ABS",
  "OBLIQUES",
  "GLUTES",
  "QUADS",
  "HAMSTRINGS",
  "ADDUCTORS",
  "CALVES",
  "CARDIO",
]);
export type MuscleGroup = z.infer<typeof muscleGroup>;

/** Mirrors the `equipment` enum: an exercise's main implement. */
export const equipment = z.enum([
  "BARBELL",
  "EZ_BAR",
  "TRAP_BAR",
  "DUMBBELL",
  "KETTLEBELL",
  "PLATE",
  "MACHINE",
  "SMITH_MACHINE",
  "CABLE",
  "BODYWEIGHT",
  "BAND",
  "SUSPENSION",
  "MEDICINE_BALL",
  "SANDBAG",
  "MACE",
  "CLUBBELL",
  "SLED",
  "CARDIO_MACHINE",
  "OTHER",
]);
export type Equipment = z.infer<typeof equipment>;

/** "UPPER_BACK" -> "upper back", for messages shown to the lifter. */
export function muscleWords(m: MuscleGroup): string {
  return m.toLowerCase().replaceAll("_", " ");
}

export const exerciseMetric = z.object({
  metric: metricKind,
  /** False: the logger offers it but a set may omit it (weight on a dip). */
  isRequired: z.boolean(),
});
export type ExerciseMetric = z.infer<typeof exerciseMetric>;

/** A name as typed: trimmed, never empty. */
const exerciseName = z.string().trim().min(1, "Give the exercise a name.");

/**
 * The catalog's muscle rules (`exercises_secondary_needs_primary_check`,
 * `exercises_muscles_disjoint_check`), as messages saying which rule failed.
 * Returns the first broken rule's message, or undefined. The service runs it
 * again on the merged row when an edit sends only one of the two lists.
 */
export function muscleRuleViolation(
  primary: readonly MuscleGroup[],
  secondary: readonly MuscleGroup[],
): string | undefined {
  if (primary.length === 0 && secondary.length > 0) {
    return "Choose a primary muscle before adding secondary muscles.";
  }
  const both = primary.filter((m) => secondary.includes(m));
  if (both.length > 0) {
    return `A muscle can't be both primary and secondary: ${both.map(muscleWords).join(", ")}.`;
  }
  return undefined;
}

const muscleList = z
  .array(muscleGroup)
  .refine((ms) => new Set(ms).size === ms.length, {
    message: "A muscle is listed twice.",
  });

/** `GET /exercises`: one row of the catalog as this user sees it. */
export const exerciseListItem = z.object({
  id: entityId,
  name: z.string(),
  /** True for the user's own exercises; false for standard ones. */
  isCustom: z.boolean(),
  isActive: z.boolean(),
  primaryMuscles: z.array(muscleGroup),
  secondaryMuscles: z.array(muscleGroup),
  equipment: equipment.nullable(),
  metrics: z.array(exerciseMetric),
  /** This user's notes on it (operations.md 2.3); null until written. */
  setup: z.string().nullable(),
  cues: z.string().nullable(),
});
export type ExerciseListItem = z.infer<typeof exerciseListItem>;

export const exercisesResponse = z.object({
  exercises: z.array(exerciseListItem),
  /** The user's weight units, for prescribing outside a workout (the builder). */
  units: unitSettings,
});
export type ExercisesResponse = z.infer<typeof exercisesResponse>;

/** `GET /exercises?includeRetired=1` also returns the user's retired ones. */
export const listExercisesQuery = z.object({
  includeRetired: z
    .enum(["0", "1"])
    .optional()
    .transform((v) => v === "1"),
});
export type ListExercisesQuery = z.infer<typeof listExercisesQuery>;

/**
 * `POST /exercises`: a custom exercise and its metrics (operations.md 2.2).
 * `id` is client-minted and is the idempotency key.
 */
export const createExerciseRequest = z
  .object({
    id: uuidV7,
    name: exerciseName,
    primaryMuscles: muscleList.default([]),
    secondaryMuscles: muscleList.default([]),
    equipment: equipment.nullable().default(null),
    metrics: z
      .array(exerciseMetric)
      .min(1, "Choose at least one thing to record, such as reps.")
      .refine(
        (ms) => new Set(ms.map((m) => m.metric)).size === ms.length,
        "A metric is listed twice.",
      ),
  })
  .superRefine((v, ctx) => {
    const message = muscleRuleViolation(v.primaryMuscles, v.secondaryMuscles);
    if (message) {
      ctx.addIssue({ code: "custom", message, path: ["secondaryMuscles"] });
    }
  });
export type CreateExerciseRequest = z.infer<typeof createExerciseRequest>;

/**
 * `PATCH /exercises/:id`: the user's own exercise only. There is no metrics
 * field -- logged sets were validated against the metrics, so a different
 * metric set is a different exercise -- and a body carrying one is refused
 * rather than silently ignored.
 */
export const editExerciseRequest = z
  .strictObject({
    name: exerciseName.optional(),
    primaryMuscles: muscleList.optional(),
    secondaryMuscles: muscleList.optional(),
    equipment: equipment.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.values(v).every((x) => x === undefined)) {
      ctx.addIssue({ code: "custom", message: "Nothing to change." });
    }
    if (v.primaryMuscles && v.secondaryMuscles) {
      const message = muscleRuleViolation(v.primaryMuscles, v.secondaryMuscles);
      if (message) {
        ctx.addIssue({ code: "custom", message, path: ["secondaryMuscles"] });
      }
    }
  });
export type EditExerciseRequest = z.infer<typeof editExerciseRequest>;

/** Free text; blank means "none", stored as null. */
const noteText = z
  .string()
  .nullable()
  .transform((s) => (s === null || s.trim() === "" ? null : s));

/**
 * `PUT /exercises/:id/notes`: setup and cues for any exercise the user can
 * see (operations.md 2.3). Both are written, absolute, so a replay is
 * harmless. `id` is the client-minted id used only if the user has no
 * settings row for this exercise yet.
 */
export const exerciseNotesRequest = z.object({
  id: uuidV7,
  setup: noteText,
  cues: noteText,
});
export type ExerciseNotesRequest = z.infer<typeof exerciseNotesRequest>;

/** Create, edit, notes, retire and reactivate all answer with the row. */
export const exerciseResponse = z.object({ exercise: exerciseListItem });
export type ExerciseResponse = z.infer<typeof exerciseResponse>;
