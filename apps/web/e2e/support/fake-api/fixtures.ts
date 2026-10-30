import {
  newId,
  type Equipment,
  type ExerciseListItem,
  type MetricKind,
  type MuscleGroup,
  type PlannedSetNode,
  type ProgramStatus,
  type TemplateSummary,
  type WeightUnit,
} from "@workout-tracker/shared";

/*
 * The fake API's data (`router.ts`): the standard catalog and the real
 * templates as the services seed them, the in-memory rows' shapes, and the
 * builders specs use to set a program up (`addProgram`'s slot and workout
 * specs). Ids are UUIDv7, as the services mint them.
 */

const NAMES: Record<string, string> = {
  "01a170d4-dadd-708f-b947-8d2400bbbb5c": "Barbell Bench Press",
  "01a170d4-dade-72d2-92b5-df913b401dab": "Overhead Press",
  "01a170d4-dade-72d2-92b5-85f242049dd0": "Incline Dumbbell Bench Press",
  "01a170d4-dade-72d2-92b5-e86fa53199c1": "Dumbbell Lateral Raise",
  "01a170d4-dadf-731e-8dc9-50411e9f92c3": "Triceps Pushdown",
  "01a170d4-dade-72d2-92b5-a960023ee68a": "Barbell Row",
  "01a170d4-dade-72d2-92b5-c65fb0ce0df3": "Lat Pulldown",
  "01a170d4-dade-72d2-92b5-b43f0911b907": "Seated Cable Row",
  "01a170d4-dadf-731e-8dc9-2b0520f435e5": "Face Pull",
  "01a170d4-dadf-731e-8dc9-37b884ad1faa": "Dumbbell Curl",
  "01a170d4-dadf-731e-8dc9-5c1432d8b0f8": "Back Squat",
  "01a170d4-dadf-731e-8dc9-81b86a9d8042": "Romanian Deadlift",
  "01a170d4-dadf-731e-8dc9-6a1b064a2d1e": "Leg Press",
  "01a170d4-dadf-731e-8dc9-8fba1fe7ab30": "Lying Leg Curl",
  "01a170d4-dadf-731e-8dc9-a595a848b32c": "Standing Calf Raise",
  "01a170d4-dade-72d2-92b5-a0c39ca6b715": "Deadlift",
  "01a170d4-dadf-731e-8dc9-70941641495b": "Bulgarian Split Squat",
  "01a170d4-dadf-731e-8dc9-6374f93ae739": "Front Squat",
  "01a170d4-dadf-731e-8dc9-3bad852baf4e": "Hammer Curl",
  "01a170d4-dadf-731e-8dc9-0c5b2a7d9e11": "Plank",
};

type Meta = [
  primary: MuscleGroup[],
  secondary: MuscleGroup[],
  equipment: Equipment,
  metrics?: [MetricKind, boolean][],
];

/** The standard exercises' muscles, equipment and metrics (reps and weight unless named). */
const META: Record<string, Meta> = {
  "Barbell Bench Press": [["CHEST"], ["TRICEPS", "FRONT_DELTS"], "BARBELL"],
  "Overhead Press": [["FRONT_DELTS"], ["TRICEPS"], "BARBELL"],
  "Incline Dumbbell Bench Press": [["CHEST"], ["FRONT_DELTS"], "DUMBBELL"],
  "Dumbbell Lateral Raise": [["SIDE_DELTS"], [], "DUMBBELL"],
  "Triceps Pushdown": [["TRICEPS"], [], "CABLE"],
  "Barbell Row": [["UPPER_BACK"], ["LATS", "BICEPS"], "BARBELL"],
  "Lat Pulldown": [["LATS"], ["BICEPS"], "CABLE"],
  "Seated Cable Row": [["UPPER_BACK"], ["LATS"], "CABLE"],
  "Face Pull": [["REAR_DELTS"], ["UPPER_BACK"], "CABLE"],
  "Dumbbell Curl": [["BICEPS"], [], "DUMBBELL"],
  "Back Squat": [["QUADS"], ["GLUTES"], "BARBELL"],
  "Romanian Deadlift": [["HAMSTRINGS"], ["GLUTES"], "BARBELL"],
  "Leg Press": [["QUADS"], ["GLUTES"], "MACHINE"],
  "Lying Leg Curl": [["HAMSTRINGS"], [], "MACHINE"],
  "Standing Calf Raise": [["CALVES"], [], "MACHINE"],
  Deadlift: [["HAMSTRINGS", "GLUTES"], ["LOWER_BACK"], "BARBELL"],
  "Bulgarian Split Squat": [["QUADS"], ["GLUTES"], "DUMBBELL"],
  "Front Squat": [["QUADS"], [], "BARBELL"],
  "Hammer Curl": [["BICEPS"], ["FOREARMS"], "DUMBBELL"],
  Plank: [["ABS"], [], "BODYWEIGHT", [["DURATION", true]]],
};

/** A prescribed set, every target open unless given. */
export function plannedSet(
  setNumber: number,
  over: Partial<PlannedSetNode> = {},
): PlannedSetNode {
  return {
    id: newId(),
    setNumber,
    targetRepsMin: null,
    targetRepsMax: null,
    targetWeight: null,
    weightUnit: null,
    targetDurationSeconds: null,
    targetDistance: null,
    distanceUnit: null,
    targetRpe: null,
    targetRir: null,
    notes: null,
    ...over,
  };
}

/** Standard exercise ids by name. */
export const EXERCISE_IDS = Object.fromEntries(
  Object.entries(NAMES).map(([id, name]) => [name, id]),
) as Record<string, string>;

export type Spec = [name: string, sets: number, min: number, max: number];

/**
 * A slot as `addProgram` takes it: the tuple (every set at min-max reps), a
 * placeholder, or an exercise with sets prescribed one by one.
 */
export type SlotSpec =
  | Spec
  | { label: string; sets: number }
  | { exercise: string; sets: number; prescribed?: Partial<PlannedSetNode>[] };

function template(
  slug: string,
  name: string,
  description: string,
  workouts: [string, Spec[]][],
): TemplateSummary {
  return {
    slug,
    name,
    description,
    workouts: workouts.map(([workoutName, exercises]) => ({
      name: workoutName,
      exercises: exercises.map(([exercise, targetSets, repsMin, repsMax]) => ({
        exerciseId: EXERCISE_IDS[exercise]!,
        name: exercise,
        targetSets,
        repsMin,
        repsMax,
      })),
    })),
  };
}

/** The real templates (`packages/db/src/templates.ts`), two of the three. */
export const TEMPLATES: TemplateSummary[] = [
  template(
    "push-pull-legs",
    "Push Pull Legs",
    "Three days: chest, shoulders and triceps; back and biceps; legs.",
    [
      [
        "Push",
        [
          ["Barbell Bench Press", 3, 5, 8],
          ["Overhead Press", 3, 6, 10],
          ["Incline Dumbbell Bench Press", 3, 8, 12],
          ["Dumbbell Lateral Raise", 3, 12, 15],
          ["Triceps Pushdown", 3, 10, 15],
        ],
      ],
      [
        "Pull",
        [
          ["Barbell Row", 3, 6, 10],
          ["Lat Pulldown", 3, 8, 12],
          ["Seated Cable Row", 3, 10, 12],
          ["Face Pull", 3, 12, 15],
          ["Dumbbell Curl", 3, 10, 12],
        ],
      ],
      [
        "Legs",
        [
          ["Back Squat", 3, 5, 8],
          ["Romanian Deadlift", 3, 8, 10],
          ["Leg Press", 3, 10, 12],
          ["Lying Leg Curl", 3, 10, 15],
          ["Standing Calf Raise", 3, 10, 15],
        ],
      ],
    ],
  ),
  template(
    "full-body-3-day",
    "Full Body 3-Day",
    "Three whole-body sessions a week, rotating A, B and C.",
    [
      [
        "Full Body A",
        [
          ["Back Squat", 3, 5, 8],
          ["Barbell Bench Press", 3, 5, 8],
          ["Barbell Row", 3, 6, 10],
          ["Dumbbell Lateral Raise", 2, 12, 15],
        ],
      ],
      [
        "Full Body B",
        [
          ["Deadlift", 3, 3, 5],
          ["Overhead Press", 3, 6, 10],
          ["Lat Pulldown", 3, 8, 12],
          ["Bulgarian Split Squat", 2, 8, 12],
        ],
      ],
      [
        "Full Body C",
        [
          ["Front Squat", 3, 6, 8],
          ["Incline Dumbbell Bench Press", 3, 8, 12],
          ["Seated Cable Row", 3, 10, 12],
          ["Hammer Curl", 2, 10, 12],
        ],
      ],
    ],
  ),
];

export interface Planned {
  plannedExerciseId: string;
  exerciseId: string | null;
  placeholderLabel: string | null;
  position: number;
  targetSets: number;
  groupKey: number | null;
  notes: string | null;
  plannedSets: PlannedSetNode[];
}
export interface Workout {
  id: string;
  programId: string;
  cycleNumber: number;
  position: number;
  name: string;
  notes: string | null;
  exercises: Planned[];
}
export interface Program {
  id: string;
  name: string;
  status: ProgramStatus;
  /** `null`: open-ended. */
  targetCycles: number | null;
}
export interface Plan {
  id: string;
  programId: string;
  cycleNumber: number;
}
export interface Session {
  id: string;
  workoutId: string;
  performedAt: string;
  status: "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
}
export interface SessionExercise {
  id: string;
  sessionId: string;
  exerciseId: string;
  plannedExerciseId: string | null;
  position: number;
}
export interface StoredSet {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
}

/** A workout as `addProgram` takes it: its name and slots. */
export type WorkoutSpec = [name: string, exercises: SlotSpec[]];

export function slotOf(
  spec: SlotSpec,
  position: number,
  idOf: (name: string) => string,
): Planned {
  const base = {
    plannedExerciseId: newId(),
    position,
    groupKey: null,
    notes: null,
  };
  if (Array.isArray(spec)) {
    const [exercise, targetSets, repsMin, repsMax] = spec;
    return {
      ...base,
      exerciseId: idOf(exercise),
      placeholderLabel: null,
      targetSets,
      plannedSets: Array.from({ length: targetSets }, (_, i) =>
        plannedSet(i + 1, { targetRepsMin: repsMin, targetRepsMax: repsMax }),
      ),
    };
  }
  if ("label" in spec) {
    return {
      ...base,
      exerciseId: null,
      placeholderLabel: spec.label,
      targetSets: spec.sets,
      plannedSets: [],
    };
  }
  return {
    ...base,
    exerciseId: idOf(spec.exercise),
    placeholderLabel: null,
    targetSets: spec.sets,
    plannedSets: (spec.prescribed ?? []).map((p, i) => plannedSet(i + 1, p)),
  };
}

/** Two short workouts, for programs whose contents don't matter to a test. */
export const UPPER_LOWER: WorkoutSpec[] = [
  [
    "Upper",
    [
      ["Barbell Bench Press", 3, 5, 8],
      ["Barbell Row", 3, 6, 10],
    ],
  ],
  [
    "Lower",
    [
      ["Back Squat", 3, 5, 8],
      ["Romanian Deadlift", 3, 8, 10],
    ],
  ],
];

/** The standard catalog, as a user sees it before adding their own. */
export function standardExercises(): Map<string, ExerciseListItem> {
  return new Map(
    Object.entries(NAMES).map(([id, name]) => {
      const [primary, secondary, equipment, metrics] = META[name]!;
      return [
        id,
        {
          id,
          name,
          isCustom: false,
          isActive: true,
          primaryMuscles: primary,
          secondaryMuscles: secondary,
          equipment,
          metrics: (
            metrics ?? [
              ["REPS", true],
              ["WEIGHT", true],
            ]
          ).map(([metric, isRequired]) => ({ metric, isRequired })),
          setup: null,
          cues: null,
        },
      ];
    }),
  );
}

/** A route's answer: its status and JSON body. */
export interface Answer {
  status: number;
  data: unknown;
}

export const ok = (data: unknown, status = 200): Answer => ({ status, data });

/** Our API's refusal: `{ ok: false, error }`. */
export const fail = (status: number, error: string): Answer => ({
  status,
  data: { ok: false, error },
});

export interface FakeUnits {
  default: WeightUnit;
  overrides: Record<string, WeightUnit>;
}
