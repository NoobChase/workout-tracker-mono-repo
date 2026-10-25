// The standard exercise catalog: content, not schema (spec step 2, decision
// 8). `npm run seed -w @workout-tracker/db` upserts it, from CI only, after
// migrations. Edit this file to change the catalog; never INSERT by hand.
//
// Rules for editing:
//
// - **Ids are frozen.** Each was minted once (UUIDv7) when the entry was
//   written. Never regenerate, reuse or reorder them: plans and history in
//   every environment point at these exact ids (data-model.md 3.3). A new
//   entry gets a new id -- `node -e "import('uuid').then(u=>console.log(u.v7()))"`.
// - **Retire, never delete.** Removing an entry does not remove the row (it is
//   ON DELETE RESTRICT from plans and sessions). Set `isActive: false` instead.
// - **Metrics decide what the logger renders** (data-model.md 2.4). Dropping a
//   metric from an entry does delete that `exercise_metrics` row on the next
//   seed; the seed only touches exercises listed here.
// - Names are unique ignoring case; `test/catalog.test.ts` checks this file.
import type { equipment, metricKind, muscleGroup } from "./schema";

type Muscle = (typeof muscleGroup.enumValues)[number];
type Equipment = (typeof equipment.enumValues)[number];
type MetricKind = (typeof metricKind.enumValues)[number];

export interface CatalogMetric {
  metric: MetricKind;
  required: boolean;
}

export interface CatalogExercise {
  id: string;
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment | null;
  metrics: readonly CatalogMetric[];
  /** Defaults to true. `false` retires the exercise (hidden, history kept). */
  isActive?: boolean;
}

const req = (metric: MetricKind): CatalogMetric => ({ metric, required: true });
const opt = (metric: MetricKind): CatalogMetric => ({
  metric,
  required: false,
});

// Metric presets. RPE is offered on all strength work and never required.
/** Loaded lifts: reps and weight both required. */
const LOADED = [req("REPS"), req("WEIGHT"), opt("RPE")] as const;
/** Bodyweight moves: reps required, added weight optional. */
const BODYWEIGHT = [req("REPS"), opt("WEIGHT"), opt("RPE")] as const;
/** Holds: time required, added weight optional. */
const HOLD = [req("DURATION"), opt("WEIGHT"), opt("RPE")] as const;
/** Carries: load required; distance or time, whichever the user tracks. */
const CARRY = [
  req("WEIGHT"),
  opt("DISTANCE"),
  opt("DURATION"),
  opt("RPE"),
] as const;
/** Pushes and drags: distance required, load optional. */
const SLED = [
  req("DISTANCE"),
  opt("WEIGHT"),
  opt("DURATION"),
  opt("RPE"),
] as const;
/** Steady-state cardio: time required, distance optional. */
const CARDIO = [req("DURATION"), opt("DISTANCE"), opt("RPE")] as const;
/** Done or not done. */
const CHECKBOX = [req("COMPLETED")] as const;

export const catalog: readonly CatalogExercise[] = [
  // --- Chest -----------------------------------------------------------------
  {
    id: "01a170d4-dadd-708f-b947-8d2400bbbb5c",
    name: "Barbell Bench Press",
    primary: ["CHEST"],
    secondary: ["TRICEPS", "FRONT_DELTS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-7d4f3f470265",
    name: "Incline Barbell Bench Press",
    primary: ["CHEST"],
    secondary: ["FRONT_DELTS", "TRICEPS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-8176fbe2e926",
    name: "Dumbbell Bench Press",
    primary: ["CHEST"],
    secondary: ["TRICEPS", "FRONT_DELTS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-85f242049dd0",
    name: "Incline Dumbbell Bench Press",
    primary: ["CHEST"],
    secondary: ["FRONT_DELTS", "TRICEPS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-8aaffc32a4e0",
    name: "Machine Chest Press",
    primary: ["CHEST"],
    secondary: ["TRICEPS", "FRONT_DELTS"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-8ed18c3c48b1",
    name: "Dumbbell Fly",
    primary: ["CHEST"],
    secondary: ["FRONT_DELTS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-913f68dfe9d5",
    name: "Cable Fly",
    primary: ["CHEST"],
    secondary: ["FRONT_DELTS"],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-94ce2480d194",
    name: "Pec Deck",
    primary: ["CHEST"],
    secondary: ["FRONT_DELTS"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-98980dec5dab",
    name: "Push-up",
    primary: ["CHEST"],
    secondary: ["TRICEPS", "FRONT_DELTS", "ABS"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dade-72d2-92b5-9c03ca3fbfc7",
    name: "Dip",
    primary: ["CHEST", "TRICEPS"],
    secondary: ["FRONT_DELTS"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },

  // --- Back ------------------------------------------------------------------
  {
    id: "01a170d4-dade-72d2-92b5-a0c39ca6b715",
    name: "Deadlift",
    primary: ["GLUTES", "HAMSTRINGS", "LOWER_BACK"],
    secondary: ["QUADS", "TRAPS", "UPPER_BACK", "FOREARMS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-a6cf96c6911c",
    name: "Trap Bar Deadlift",
    primary: ["QUADS", "GLUTES"],
    secondary: ["HAMSTRINGS", "LOWER_BACK", "TRAPS", "FOREARMS"],
    equipment: "TRAP_BAR",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-a960023ee68a",
    name: "Barbell Row",
    primary: ["UPPER_BACK", "LATS"],
    secondary: ["BICEPS", "REAR_DELTS", "LOWER_BACK"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-af202d2bb33e",
    name: "One-Arm Dumbbell Row",
    primary: ["LATS", "UPPER_BACK"],
    secondary: ["BICEPS", "REAR_DELTS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-b047dfd749c2",
    name: "T-Bar Row",
    primary: ["UPPER_BACK", "LATS"],
    secondary: ["BICEPS", "REAR_DELTS", "LOWER_BACK"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-b43f0911b907",
    name: "Seated Cable Row",
    primary: ["UPPER_BACK", "LATS"],
    secondary: ["BICEPS", "REAR_DELTS"],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-b8e22bfa00b6",
    name: "Chest-Supported Machine Row",
    primary: ["UPPER_BACK"],
    secondary: ["LATS", "BICEPS", "REAR_DELTS"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-bd67067f5099",
    name: "Pull-up",
    primary: ["LATS"],
    secondary: ["BICEPS", "UPPER_BACK"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dade-72d2-92b5-c1d3587e6504",
    name: "Chin-up",
    primary: ["LATS", "BICEPS"],
    secondary: ["UPPER_BACK"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dade-72d2-92b5-c65fb0ce0df3",
    name: "Lat Pulldown",
    primary: ["LATS"],
    secondary: ["BICEPS", "UPPER_BACK"],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-c8c55fa36fb2",
    name: "Straight-Arm Pulldown",
    primary: ["LATS"],
    secondary: [],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-ccd330635157",
    name: "Inverted Row",
    primary: ["UPPER_BACK", "LATS"],
    secondary: ["BICEPS", "REAR_DELTS"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dade-72d2-92b5-d0cdd0144e9d",
    name: "Back Extension",
    primary: ["LOWER_BACK", "GLUTES"],
    secondary: ["HAMSTRINGS"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dade-72d2-92b5-d6c393e5a11f",
    name: "Barbell Shrug",
    primary: ["TRAPS"],
    secondary: ["FOREARMS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-d8a8c67716c0",
    name: "Dumbbell Shrug",
    primary: ["TRAPS"],
    secondary: ["FOREARMS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },

  // --- Shoulders -------------------------------------------------------------
  {
    id: "01a170d4-dade-72d2-92b5-df913b401dab",
    name: "Overhead Press",
    primary: ["FRONT_DELTS"],
    secondary: ["TRICEPS", "SIDE_DELTS", "UPPER_BACK"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-e2f3daa183e2",
    name: "Seated Dumbbell Shoulder Press",
    primary: ["FRONT_DELTS"],
    secondary: ["TRICEPS", "SIDE_DELTS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-e432ffc7d7f8",
    name: "Machine Shoulder Press",
    primary: ["FRONT_DELTS"],
    secondary: ["TRICEPS", "SIDE_DELTS"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-e86fa53199c1",
    name: "Dumbbell Lateral Raise",
    primary: ["SIDE_DELTS"],
    secondary: ["TRAPS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-ed59dbb456a7",
    name: "Cable Lateral Raise",
    primary: ["SIDE_DELTS"],
    secondary: [],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-f38e040bc892",
    name: "Dumbbell Front Raise",
    primary: ["FRONT_DELTS"],
    secondary: [],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dade-72d2-92b5-f404ed3e7341",
    name: "Dumbbell Reverse Fly",
    primary: ["REAR_DELTS"],
    secondary: ["UPPER_BACK"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-24f2ad2d0679",
    name: "Reverse Pec Deck",
    primary: ["REAR_DELTS"],
    secondary: ["UPPER_BACK"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-2b0520f435e5",
    name: "Face Pull",
    primary: ["REAR_DELTS"],
    secondary: ["UPPER_BACK", "TRAPS"],
    equipment: "CABLE",
    metrics: LOADED,
  },

  // --- Arms ------------------------------------------------------------------
  {
    id: "01a170d4-dadf-731e-8dc9-2d712de26275",
    name: "Barbell Curl",
    primary: ["BICEPS"],
    secondary: ["FOREARMS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-30904bc7faa3",
    name: "EZ-Bar Curl",
    primary: ["BICEPS"],
    secondary: ["FOREARMS"],
    equipment: "EZ_BAR",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-37b884ad1faa",
    name: "Dumbbell Curl",
    primary: ["BICEPS"],
    secondary: ["FOREARMS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-3bad852baf4e",
    name: "Hammer Curl",
    primary: ["BICEPS", "FOREARMS"],
    secondary: [],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-3c0936596999",
    name: "Incline Dumbbell Curl",
    primary: ["BICEPS"],
    secondary: [],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-4352284baceb",
    name: "Preacher Curl",
    primary: ["BICEPS"],
    secondary: [],
    equipment: "EZ_BAR",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-46f77f25db78",
    name: "Cable Curl",
    primary: ["BICEPS"],
    secondary: ["FOREARMS"],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-4b7ef40a6d57",
    name: "Close-Grip Bench Press",
    primary: ["TRICEPS", "CHEST"],
    secondary: ["FRONT_DELTS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-4c00a9efc417",
    name: "Skull Crusher",
    primary: ["TRICEPS"],
    secondary: [],
    equipment: "EZ_BAR",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-50411e9f92c3",
    name: "Triceps Pushdown",
    primary: ["TRICEPS"],
    secondary: [],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-55cb46499144",
    name: "Overhead Cable Triceps Extension",
    primary: ["TRICEPS"],
    secondary: [],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-5be47121c3d4",
    name: "Dumbbell Wrist Curl",
    primary: ["FOREARMS"],
    secondary: [],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },

  // --- Legs ------------------------------------------------------------------
  {
    id: "01a170d4-dadf-731e-8dc9-5c1432d8b0f8",
    name: "Back Squat",
    primary: ["QUADS", "GLUTES"],
    secondary: ["ADDUCTORS", "LOWER_BACK"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-6374f93ae739",
    name: "Front Squat",
    primary: ["QUADS"],
    secondary: ["GLUTES", "UPPER_BACK", "ABS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-67d2631c65c1",
    name: "Goblet Squat",
    primary: ["QUADS", "GLUTES"],
    secondary: ["ADDUCTORS", "ABS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-6a1b064a2d1e",
    name: "Leg Press",
    primary: ["QUADS", "GLUTES"],
    secondary: ["ADDUCTORS"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-6e474a69dba4",
    name: "Hack Squat",
    primary: ["QUADS"],
    secondary: ["GLUTES"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-70941641495b",
    name: "Bulgarian Split Squat",
    primary: ["QUADS", "GLUTES"],
    secondary: ["ADDUCTORS", "HAMSTRINGS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-7410e00ab402",
    name: "Walking Lunge",
    primary: ["QUADS", "GLUTES"],
    secondary: ["HAMSTRINGS", "ADDUCTORS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-7a1617425f70",
    name: "Step-up",
    primary: ["QUADS", "GLUTES"],
    secondary: ["HAMSTRINGS"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-7e8af9b842af",
    name: "Leg Extension",
    primary: ["QUADS"],
    secondary: [],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-81b86a9d8042",
    name: "Romanian Deadlift",
    primary: ["HAMSTRINGS", "GLUTES"],
    secondary: ["LOWER_BACK", "FOREARMS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-87e585659caf",
    name: "Dumbbell Romanian Deadlift",
    primary: ["HAMSTRINGS", "GLUTES"],
    secondary: ["LOWER_BACK"],
    equipment: "DUMBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-88ca646549d4",
    name: "Good Morning",
    primary: ["HAMSTRINGS", "LOWER_BACK"],
    secondary: ["GLUTES"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-8fba1fe7ab30",
    name: "Lying Leg Curl",
    primary: ["HAMSTRINGS"],
    secondary: ["CALVES"],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-9071f62176cb",
    name: "Seated Leg Curl",
    primary: ["HAMSTRINGS"],
    secondary: [],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-96c07d0f1fa9",
    name: "Nordic Hamstring Curl",
    primary: ["HAMSTRINGS"],
    secondary: [],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-9a5e21990974",
    name: "Barbell Hip Thrust",
    primary: ["GLUTES"],
    secondary: ["HAMSTRINGS", "QUADS"],
    equipment: "BARBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-9e5d81c4df7e",
    name: "Glute Bridge",
    primary: ["GLUTES"],
    secondary: ["HAMSTRINGS"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-a2362538849e",
    name: "Hip Adduction Machine",
    primary: ["ADDUCTORS"],
    secondary: [],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-a595a848b32c",
    name: "Standing Calf Raise",
    primary: ["CALVES"],
    secondary: [],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-ab80032813f5",
    name: "Seated Calf Raise",
    primary: ["CALVES"],
    secondary: [],
    equipment: "MACHINE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-ac5312228a03",
    name: "Kettlebell Swing",
    primary: ["GLUTES", "HAMSTRINGS"],
    secondary: ["LOWER_BACK", "ABS", "FOREARMS"],
    equipment: "KETTLEBELL",
    metrics: LOADED,
  },

  // --- Core ------------------------------------------------------------------
  {
    id: "01a170d4-dadf-731e-8dc9-b2e4cdf8caa2",
    name: "Plank",
    primary: ["ABS"],
    secondary: ["OBLIQUES"],
    equipment: "BODYWEIGHT",
    metrics: HOLD,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-b69cf048261d",
    name: "Side Plank",
    primary: ["OBLIQUES"],
    secondary: ["ABS"],
    equipment: "BODYWEIGHT",
    metrics: HOLD,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-bb0fe660d0c9",
    name: "Hanging Leg Raise",
    primary: ["ABS"],
    secondary: ["OBLIQUES", "FOREARMS"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-bcf98f33683f",
    name: "Cable Crunch",
    primary: ["ABS"],
    secondary: ["OBLIQUES"],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-c0f7bc6d0b56",
    name: "Ab Wheel Rollout",
    primary: ["ABS"],
    secondary: ["LATS", "OBLIQUES"],
    equipment: "OTHER",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-c5adea862bed",
    name: "Pallof Press",
    primary: ["OBLIQUES"],
    secondary: ["ABS"],
    equipment: "CABLE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-c91cead174ba",
    name: "Russian Twist",
    primary: ["OBLIQUES"],
    secondary: ["ABS"],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-cea8b2b8209f",
    name: "Dead Bug",
    primary: ["ABS"],
    secondary: [],
    equipment: "BODYWEIGHT",
    metrics: BODYWEIGHT,
  },

  // --- Carries, odd objects, full body ---------------------------------------
  {
    id: "01a170d4-dadf-731e-8dc9-d123a6439dff",
    name: "Farmer's Carry",
    primary: ["FOREARMS", "TRAPS"],
    secondary: ["ABS", "GLUTES"],
    equipment: "DUMBBELL",
    metrics: CARRY,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-d51c079bffc8",
    name: "Sandbag Carry",
    primary: ["UPPER_BACK", "ABS"],
    secondary: ["GLUTES", "BICEPS"],
    equipment: "SANDBAG",
    metrics: CARRY,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-d9bec2bf01bf",
    name: "Sandbag Clean",
    primary: ["GLUTES", "HAMSTRINGS"],
    secondary: ["UPPER_BACK", "BICEPS", "LOWER_BACK"],
    equipment: "SANDBAG",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-de68facadf98",
    name: "Sled Push",
    primary: ["QUADS", "GLUTES"],
    secondary: ["CALVES"],
    equipment: "SLED",
    metrics: SLED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-e2764e36934a",
    name: "Mace 360",
    primary: ["FRONT_DELTS", "LATS"],
    secondary: ["OBLIQUES", "TRICEPS", "FOREARMS"],
    equipment: "MACE",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-e7b2c0406abb",
    name: "Clubbell Swing",
    primary: ["FRONT_DELTS", "LATS"],
    secondary: ["FOREARMS", "OBLIQUES"],
    equipment: "CLUBBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-ea735ba95c04",
    name: "Turkish Get-up",
    primary: ["FRONT_DELTS", "ABS"],
    secondary: ["GLUTES", "OBLIQUES"],
    equipment: "KETTLEBELL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-eec40f578983",
    name: "Medicine Ball Slam",
    primary: ["ABS", "LATS"],
    secondary: ["FRONT_DELTS"],
    equipment: "MEDICINE_BALL",
    metrics: LOADED,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-f331efadc8d1",
    name: "Suspension Row",
    primary: ["UPPER_BACK", "LATS"],
    secondary: ["BICEPS", "REAR_DELTS"],
    equipment: "SUSPENSION",
    metrics: BODYWEIGHT,
  },

  // --- Cardio ----------------------------------------------------------------
  {
    id: "01a170d4-dadf-731e-8dc9-f710744f548b",
    name: "Treadmill Run",
    primary: ["CARDIO"],
    secondary: [],
    equipment: "CARDIO_MACHINE",
    metrics: CARDIO,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-fbf9b609ee68",
    name: "Outdoor Run",
    primary: ["CARDIO"],
    secondary: [],
    equipment: "BODYWEIGHT",
    metrics: CARDIO,
  },
  {
    id: "01a170d4-dadf-731e-8dc9-fd359f76c31b",
    name: "Rowing Machine",
    primary: ["CARDIO"],
    secondary: ["LATS", "UPPER_BACK", "QUADS"],
    equipment: "CARDIO_MACHINE",
    metrics: CARDIO,
  },
  {
    id: "01a170d4-dadf-731e-8dca-006afd6a280e",
    name: "Stationary Bike",
    primary: ["CARDIO"],
    secondary: ["QUADS"],
    equipment: "CARDIO_MACHINE",
    metrics: CARDIO,
  },
  {
    id: "01a170d4-dadf-731e-8dca-07b58eff3be4",
    name: "Stair Climber",
    primary: ["CARDIO"],
    secondary: ["GLUTES", "QUADS"],
    equipment: "CARDIO_MACHINE",
    metrics: CARDIO,
  },
  {
    id: "01a170d4-dadf-731e-8dca-09f3220d0fa5",
    name: "Elliptical",
    primary: ["CARDIO"],
    secondary: [],
    equipment: "CARDIO_MACHINE",
    metrics: CARDIO,
  },
  {
    id: "01a170d4-dadf-731e-8dca-0c499a7f1081",
    name: "Jump Rope",
    primary: ["CARDIO"],
    secondary: ["CALVES"],
    equipment: "OTHER",
    metrics: CARDIO,
  },

  // --- Mobility --------------------------------------------------------------
  {
    id: "01a170d4-dadf-731e-8dca-1367c5eb30e6",
    name: "Hip Mobility Flow",
    primary: [],
    secondary: [],
    equipment: "BODYWEIGHT",
    metrics: CHECKBOX,
  },
];
