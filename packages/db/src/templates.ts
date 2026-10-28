// The default program templates (design D2 of the step-3 change): content,
// not schema, held the way catalog.ts holds exercises. Starting one runs the
// ordinary create-program transaction (operations.md 3.1) as an open-ended
// program and activates it (3.10); nothing here is ever a row until a user
// starts it, and nothing is shared between the programs it creates
// (data-model.md 2.2).
//
// Rules for editing:
//
// - **Slugs are frozen.** Clients and links name a template by slug. Rename
//   the `name`, never the `slug`; a template that goes away is removed, and
//   programs already started from it are unaffected.
// - **Standard, active, weighted and rep-based exercises only**, by their
//   frozen catalog ids, and no placeholder slots: step 3 logs reps and weight
//   and nothing else (proposal, "Out of scope"). `test/templates.test.ts`
//   checks every id against catalog.ts.
// - **No weights.** A template prescribes sets and a rep range; the lifter
//   brings the load.
//
// The current content is test content; the user reworks it before production.

/** One planned exercise: `targetSets` sets of `repsMin`-`repsMax` reps. */
export interface TemplateExercise {
  readonly exerciseId: string;
  readonly targetSets: number;
  readonly repsMin: number;
  readonly repsMax: number;
}

export interface TemplateWorkout {
  readonly name: string;
  /** In order; the index is the planned exercise's position. */
  readonly exercises: readonly TemplateExercise[];
}

export interface ProgramTemplate {
  readonly slug: string;
  readonly name: string;
  /** One line, shown in the template list. */
  readonly description: string;
  /** In order; the index is the workout's position in the cycle. */
  readonly workouts: readonly TemplateWorkout[];
}

const ex = (
  exerciseId: string,
  targetSets: number,
  repsMin: number,
  repsMax: number,
): TemplateExercise => ({ exerciseId, targetSets, repsMin, repsMax });

export const TEMPLATES: readonly ProgramTemplate[] = [
  {
    slug: "push-pull-legs",
    name: "Push Pull Legs",
    description:
      "Three days: chest, shoulders and triceps; back and biceps; legs.",
    workouts: [
      {
        name: "Push",
        exercises: [
          ex("01a170d4-dadd-708f-b947-8d2400bbbb5c", 3, 5, 8), // Barbell Bench Press
          ex("01a170d4-dade-72d2-92b5-df913b401dab", 3, 6, 10), // Overhead Press
          ex("01a170d4-dade-72d2-92b5-85f242049dd0", 3, 8, 12), // Incline Dumbbell Bench Press
          ex("01a170d4-dade-72d2-92b5-e86fa53199c1", 3, 12, 15), // Dumbbell Lateral Raise
          ex("01a170d4-dadf-731e-8dc9-50411e9f92c3", 3, 10, 15), // Triceps Pushdown
        ],
      },
      {
        name: "Pull",
        exercises: [
          ex("01a170d4-dade-72d2-92b5-a960023ee68a", 3, 6, 10), // Barbell Row
          ex("01a170d4-dade-72d2-92b5-c65fb0ce0df3", 3, 8, 12), // Lat Pulldown
          ex("01a170d4-dade-72d2-92b5-b43f0911b907", 3, 10, 12), // Seated Cable Row
          ex("01a170d4-dadf-731e-8dc9-2b0520f435e5", 3, 12, 15), // Face Pull
          ex("01a170d4-dadf-731e-8dc9-37b884ad1faa", 3, 10, 12), // Dumbbell Curl
        ],
      },
      {
        name: "Legs",
        exercises: [
          ex("01a170d4-dadf-731e-8dc9-5c1432d8b0f8", 3, 5, 8), // Back Squat
          ex("01a170d4-dadf-731e-8dc9-81b86a9d8042", 3, 8, 10), // Romanian Deadlift
          ex("01a170d4-dadf-731e-8dc9-6a1b064a2d1e", 3, 10, 12), // Leg Press
          ex("01a170d4-dadf-731e-8dc9-8fba1fe7ab30", 3, 10, 15), // Lying Leg Curl
          ex("01a170d4-dadf-731e-8dc9-a595a848b32c", 3, 10, 15), // Standing Calf Raise
        ],
      },
    ],
  },
  {
    slug: "full-body-3-day",
    name: "Full Body 3-Day",
    description: "Three whole-body sessions a week, rotating A, B and C.",
    workouts: [
      {
        name: "Full Body A",
        exercises: [
          ex("01a170d4-dadf-731e-8dc9-5c1432d8b0f8", 3, 5, 8), // Back Squat
          ex("01a170d4-dadd-708f-b947-8d2400bbbb5c", 3, 5, 8), // Barbell Bench Press
          ex("01a170d4-dade-72d2-92b5-a960023ee68a", 3, 6, 10), // Barbell Row
          ex("01a170d4-dade-72d2-92b5-e86fa53199c1", 2, 12, 15), // Dumbbell Lateral Raise
        ],
      },
      {
        name: "Full Body B",
        exercises: [
          ex("01a170d4-dade-72d2-92b5-a0c39ca6b715", 3, 3, 5), // Deadlift
          ex("01a170d4-dade-72d2-92b5-df913b401dab", 3, 6, 10), // Overhead Press
          ex("01a170d4-dade-72d2-92b5-c65fb0ce0df3", 3, 8, 12), // Lat Pulldown
          ex("01a170d4-dadf-731e-8dc9-70941641495b", 2, 8, 12), // Bulgarian Split Squat
        ],
      },
      {
        name: "Full Body C",
        exercises: [
          ex("01a170d4-dadf-731e-8dc9-6374f93ae739", 3, 6, 8), // Front Squat
          ex("01a170d4-dade-72d2-92b5-85f242049dd0", 3, 8, 12), // Incline Dumbbell Bench Press
          ex("01a170d4-dade-72d2-92b5-b43f0911b907", 3, 10, 12), // Seated Cable Row
          ex("01a170d4-dadf-731e-8dc9-3bad852baf4e", 2, 10, 12), // Hammer Curl
        ],
      },
    ],
  },
  {
    slug: "upper-lower-4-day",
    name: "Upper Lower 4-Day",
    description:
      "Four days a week, alternating upper-body and lower-body sessions.",
    workouts: [
      {
        name: "Upper A",
        exercises: [
          ex("01a170d4-dadd-708f-b947-8d2400bbbb5c", 4, 5, 8), // Barbell Bench Press
          ex("01a170d4-dade-72d2-92b5-a960023ee68a", 4, 6, 10), // Barbell Row
          ex("01a170d4-dade-72d2-92b5-df913b401dab", 3, 8, 10), // Overhead Press
          ex("01a170d4-dade-72d2-92b5-c65fb0ce0df3", 3, 10, 12), // Lat Pulldown
          ex("01a170d4-dadf-731e-8dc9-30904bc7faa3", 2, 10, 12), // EZ-Bar Curl
          ex("01a170d4-dadf-731e-8dc9-4c00a9efc417", 2, 10, 12), // Skull Crusher
        ],
      },
      {
        name: "Lower A",
        exercises: [
          ex("01a170d4-dadf-731e-8dc9-5c1432d8b0f8", 4, 5, 8), // Back Squat
          ex("01a170d4-dadf-731e-8dc9-81b86a9d8042", 3, 8, 10), // Romanian Deadlift
          ex("01a170d4-dadf-731e-8dc9-7e8af9b842af", 3, 10, 15), // Leg Extension
          ex("01a170d4-dadf-731e-8dc9-9071f62176cb", 3, 10, 15), // Seated Leg Curl
          ex("01a170d4-dadf-731e-8dc9-a595a848b32c", 3, 10, 15), // Standing Calf Raise
        ],
      },
      {
        name: "Upper B",
        exercises: [
          ex("01a170d4-dade-72d2-92b5-7d4f3f470265", 3, 6, 10), // Incline Barbell Bench Press
          ex("01a170d4-dade-72d2-92b5-b8e22bfa00b6", 3, 8, 12), // Chest-Supported Machine Row
          ex("01a170d4-dade-72d2-92b5-e2f3daa183e2", 3, 8, 12), // Seated Dumbbell Shoulder Press
          ex("01a170d4-dade-72d2-92b5-ed59dbb456a7", 3, 12, 15), // Cable Lateral Raise
          ex("01a170d4-dadf-731e-8dc9-50411e9f92c3", 2, 10, 15), // Triceps Pushdown
          ex("01a170d4-dadf-731e-8dc9-3bad852baf4e", 2, 10, 12), // Hammer Curl
        ],
      },
      {
        name: "Lower B",
        exercises: [
          ex("01a170d4-dade-72d2-92b5-a0c39ca6b715", 3, 3, 5), // Deadlift
          ex("01a170d4-dadf-731e-8dc9-6a1b064a2d1e", 3, 10, 12), // Leg Press
          ex("01a170d4-dadf-731e-8dc9-7410e00ab402", 2, 10, 12), // Walking Lunge
          ex("01a170d4-dadf-731e-8dc9-8fba1fe7ab30", 3, 10, 15), // Lying Leg Curl
          ex("01a170d4-dadf-731e-8dc9-ab80032813f5", 3, 12, 15), // Seated Calf Raise
        ],
      },
    ],
  },
];

/** The template with this slug, or `undefined`. */
export function findTemplate(slug: string): ProgramTemplate | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
