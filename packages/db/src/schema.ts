// The schema. Source of truth for the database's structure: change this file,
// run `npm run generate -w @workout-tracker/db`, read the SQL, commit both.
// The reasoning behind each table lives in docs/data-model.md; this file is
// what replaced that document's DDL.
//
// Conventions that hold for every table:
//
// - Primary keys are UUIDv7 minted in application code. No column default --
//   the id doubles as the idempotency key (data-model.md 2.11).
// - Constraint and index names are spelled out, in Postgres's own `_key` /
//   `_check` style, so the names a test or an error message refers to are the
//   names written here.
//
// One thing this file cannot say: four uniques are DEFERRABLE INITIALLY
// DEFERRED in the database -- the position uniques on `workouts`,
// `planned_exercises` and `session_exercises`, and the set-number unique on
// `session_sets`. Drizzle has no API for that, so they are declared here as
// plain uniques and made deferrable by --custom migrations (migrations/0001,
// migrations/0005). Changing any of these constraints' columns makes
// drizzle-kit recreate it *without* the clause -- follow that migration with
// another --custom one. test/schema.test.ts fails if it is forgotten.
// (specs/shipped/step-2-auth-and-core-schema decision 7.)
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --- Enums (data-model.md 3.1) ---------------------------------------------
//
// Adding a value to weight_unit or distance_unit: grep for every CASE over it.
// The unit-conversion CASEs name each value and have no ELSE (data-model.md
// 2.5), so a missed one goes visibly NULL rather than silently wrong.

export const metricKind = pgEnum("metric_kind", [
  "REPS",
  "WEIGHT",
  "DURATION",
  "DISTANCE",
  "COMPLETED",
  "RPE",
]);
export const weightUnit = pgEnum("weight_unit", ["LB", "KG"]);
export const distanceUnit = pgEnum("distance_unit", ["MI", "KM", "M", "FT"]);
export const programStatus = pgEnum("program_status", [
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
  "ARCHIVED",
]);
export const sessionStatus = pgEnum("session_status", [
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
]);
export const setType = pgEnum("set_type", ["NORMAL", "WARMUP", "DROP"]);
// What an exercise works (data-model.md 3.3). CARDIO is not a muscle; it is
// the honest group for a treadmill or a rower, hence `muscle_group`.
export const muscleGroup = pgEnum("muscle_group", [
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
// An exercise's main implement (data-model.md 3.3). One per exercise.
export const equipment = pgEnum("equipment", [
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
export const subStatus = pgEnum("sub_status", [
  "NONE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// --- Users (data-model.md 3.2) ---------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    clerkUserId: text("clerk_user_id")
      .notNull()
      .unique("users_clerk_user_id_key"),
    defaultWeightUnit: weightUnit("default_weight_unit")
      .notNull()
      .default("LB"),
    subStatus: subStatus("sub_status").notNull().default("NONE"),
    subCurrentPeriodEnd: timestamptz("sub_current_period_end"),
    stripeCustomerId: text("stripe_customer_id").unique(
      "users_stripe_customer_id_key",
    ),
    deletedAt: timestamptz("deleted_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("users_pending_purge_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`),
  ],
);

// --- Exercise catalog (data-model.md 3.3) ----------------------------------

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey(),
    // NULL = standard (ships with the app, visible to everyone).
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    // Both optional, so a custom exercise can be saved without them; a
    // secondary muscle without a primary is refused by the check below.
    primaryMuscles: muscleGroup("primary_muscles")
      .array()
      .notNull()
      .default(sql`'{}'`),
    secondaryMuscles: muscleGroup("secondary_muscles")
      .array()
      .notNull()
      .default(sql`'{}'`),
    equipment: equipment("equipment"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Retiring (is_active = false) deliberately does not free the name.
    uniqueIndex("exercises_standard_name_key")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.ownerUserId} IS NULL`),
    uniqueIndex("exercises_user_name_key")
      .on(t.ownerUserId, sql`lower(${t.name})`)
      .where(sql`${t.ownerUserId} IS NOT NULL`),
    check(
      "exercises_secondary_needs_primary_check",
      sql`cardinality(${t.primaryMuscles}) > 0 OR cardinality(${t.secondaryMuscles}) = 0`,
    ),
    check(
      "exercises_muscles_disjoint_check",
      sql`NOT (${t.primaryMuscles} && ${t.secondaryMuscles})`,
    ),
  ],
);

export const exerciseMetrics = pgTable(
  "exercise_metrics",
  {
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    metric: metricKind("metric").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
  },
  (t) => [
    primaryKey({
      name: "exercise_metrics_pkey",
      columns: [t.exerciseId, t.metric],
    }),
  ],
);

// --- Per-user exercise settings (data-model.md 3.4) ------------------------

export const userExerciseSettings = pgTable(
  "user_exercise_settings",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Nothing here stops this pointing at another user's private exercise --
    // that invariant belongs to the scoping primitives, not the schema.
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    setup: text("setup"),
    cues: text("cues"),
    // NULL = fall back to users.default_weight_unit.
    defaultWeightUnit: weightUnit("default_weight_unit"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("user_exercise_settings_user_id_exercise_id_key").on(
      t.userId,
      t.exerciseId,
    ),
  ],
);

// --- Program -> Plan -> Workout -> Planned exercise -> Planned set (3.5) ---

export const workoutPrograms = pgTable(
  "workout_programs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    status: programStatus("status").notNull().default("DRAFT"),
    // NULL = open-ended.
    targetCycles: smallint("target_cycles"),
    startDate: date("start_date"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Copying a program auto-suffixes the name rather than colliding here
    // (operations.md 3.9).
    unique("workout_programs_user_id_name_key").on(t.userId, t.name),
    // Any number may be ACTIVE at once -- a lifting block alongside a running
    // block (data-model.md 7). "What's next?" answers per program.
    check("workout_programs_target_cycles_check", sql`${t.targetCycles} >= 1`),
  ],
);

// One row per cycle: a 12-cycle program has 12 plans.
export const workoutPlans = pgTable(
  "workout_plans",
  {
    id: uuid("id").primaryKey(),
    programId: uuid("program_id")
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: "cascade" }),
    cycleNumber: smallint("cycle_number").notNull(),
    name: text("name"),
    notes: text("notes"),
  },
  (t) => [
    unique("workout_plans_program_id_cycle_number_key").on(
      t.programId,
      t.cycleNumber,
    ),
    check("workout_plans_cycle_number_check", sql`${t.cycleNumber} >= 1`),
  ],
);

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => workoutPlans.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: smallint("position").notNull(),
    notes: text("notes"),
  },
  (t) => [
    // DEFERRABLE INITIALLY DEFERRED in the database -- see the header.
    unique("workouts_plan_id_position_key").on(t.planId, t.position),
    check("workouts_position_check", sql`${t.position} >= 0`),
  ],
);

export const plannedExercises = pgTable(
  "planned_exercises",
  {
    id: uuid("id").primaryKey(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id").references(() => exercises.id, {
      onDelete: "restrict",
    }),
    // "Quads", "Hamstring accessory" -- the exercise is chosen on the day.
    placeholderLabel: text("placeholder_label"),
    position: smallint("position").notNull(),
    targetSets: smallint("target_sets"),
    // NULL = standalone; equal values = one superset/circuit.
    groupKey: smallint("group_key"),
    notes: text("notes"),
  },
  (t) => [
    // DEFERRABLE INITIALLY DEFERRED in the database -- see the header.
    unique("planned_exercises_workout_id_position_key").on(
      t.workoutId,
      t.position,
    ),
    check("planned_exercises_position_check", sql`${t.position} >= 0`),
    check("planned_exercises_target_sets_check", sql`${t.targetSets} > 0`),
    check(
      "planned_exercises_exercise_or_placeholder_check",
      sql`num_nonnulls(${t.exerciseId}, ${t.placeholderLabel}) = 1`,
    ),
  ],
);

// No kind, no parent_set_id: set technique is logged, not prescribed (2.8).
export const plannedSets = pgTable(
  "planned_sets",
  {
    id: uuid("id").primaryKey(),
    plannedExerciseId: uuid("planned_exercise_id")
      .notNull()
      .references(() => plannedExercises.id, { onDelete: "cascade" }),
    setNumber: smallint("set_number").notNull(),
    targetRepsMin: smallint("target_reps_min"),
    targetRepsMax: smallint("target_reps_max"),
    targetWeight: numeric("target_weight", { precision: 7, scale: 2 }),
    weightUnit: weightUnit("weight_unit"),
    // Comparison-only canonical weight. Every unit named, no ELSE (2.5).
    targetWeightKg: numeric("target_weight_kg", {
      precision: 10,
      scale: 4,
    }).generatedAlwaysAs(
      sql`target_weight * CASE weight_unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END`,
    ),
    targetDurationSeconds: integer("target_duration_seconds"),
    targetDistance: numeric("target_distance", { precision: 9, scale: 3 }),
    distanceUnit: distanceUnit("distance_unit"),
    targetRpe: numeric("target_rpe", { precision: 3, scale: 1 }),
    notes: text("notes"),
  },
  (t) => [
    unique("planned_sets_planned_exercise_id_set_number_key").on(
      t.plannedExerciseId,
      t.setNumber,
    ),
    check("planned_sets_set_number_check", sql`${t.setNumber} >= 1`),
    check("planned_sets_target_reps_min_check", sql`${t.targetRepsMin} >= 0`),
    check("planned_sets_target_reps_max_check", sql`${t.targetRepsMax} >= 0`),
    check("planned_sets_target_weight_check", sql`${t.targetWeight} >= 0`),
    check(
      "planned_sets_target_duration_seconds_check",
      sql`${t.targetDurationSeconds} >= 0`,
    ),
    check("planned_sets_target_distance_check", sql`${t.targetDistance} >= 0`),
    check(
      "planned_sets_target_rpe_check",
      sql`${t.targetRpe} BETWEEN 0 AND 10`,
    ),
    check(
      "planned_sets_reps_range_check",
      sql`${t.targetRepsMin} IS NULL OR ${t.targetRepsMax} IS NULL OR ${t.targetRepsMin} <= ${t.targetRepsMax}`,
    ),
    // Without these, a weight with no unit makes target_weight_kg NULL and
    // silently drops out of every aggregate.
    check(
      "planned_sets_weight_unit_check",
      sql`${t.targetWeight} IS NULL OR ${t.weightUnit} IS NOT NULL`,
    ),
    check(
      "planned_sets_distance_unit_check",
      sql`${t.targetDistance} IS NULL OR ${t.distanceUnit} IS NOT NULL`,
    ),
  ],
);

// --- Session -> Session exercise -> Session set (data-model.md 3.6) --------
//
// What happened, never what was intended (operations.md 0.1): starting a
// workout writes one workout_sessions row, and the rows below appear only when
// something is logged. A set that did not happen is no row.
//
// Two invariants are deliberately absent here and live in src/scope.ts
// instead: that `workout_id` and `planned_exercise_id` belong to the session's
// user (data-model.md 3.6, "Two constraints that are deliberately absent").

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // NULL = ad-hoc. RESTRICT: a workout with logged history cannot be
    // deleted (data-model.md 4).
    workoutId: uuid("workout_id").references(() => workouts.id, {
      onDelete: "restrict",
    }),
    // Sent by the device when the lifter started; the default only covers a
    // write that carries no time.
    performedAt: timestamptz("performed_at").notNull().defaultNow(),
    status: sessionStatus("status").notNull().default("IN_PROGRESS"),
    notes: text("notes"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Deliberately no "one IN_PROGRESS per user" unique: the offline queue
    // could never resolve its rejection (data-model.md 3.6).
    index("workout_sessions_user_date_idx").on(
      t.userId,
      t.performedAt.desc().nullsFirst(),
    ),
    index("workout_sessions_workout_idx").on(t.workoutId),
  ],
);

export const sessionExercises = pgTable(
  "session_exercises",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    // NULL = added on the fly, off-script. SET NULL: editing the plan orphans
    // the link, never the log.
    plannedExerciseId: uuid("planned_exercise_id").references(
      () => plannedExercises.id,
      { onDelete: "set null" },
    ),
    position: smallint("position").notNull(),
    // NULL = standalone; equal values = one superset/circuit.
    groupKey: smallint("group_key"),
    // "squat rack taken"
    substitutionNote: text("substitution_note"),
    notes: text("notes"),
  },
  (t) => [
    // DEFERRABLE INITIALLY DEFERRED in the database -- see the header.
    unique("session_exercises_session_id_position_key").on(
      t.sessionId,
      t.position,
    ),
    check("session_exercises_position_check", sql`${t.position} >= 0`),
    index("session_exercises_exercise_idx").on(t.exerciseId),
  ],
);

export const sessionSets = pgTable(
  "session_sets",
  {
    id: uuid("id").primaryKey(),
    sessionExerciseId: uuid("session_exercise_id")
      .notNull()
      .references(() => sessionExercises.id, { onDelete: "cascade" }),
    // A flat, stable sequence -- not the working-set ordinal the user sees.
    setNumber: smallint("set_number").notNull(),
    reps: smallint("reps"),
    weight: numeric("weight", { precision: 7, scale: 2 }),
    weightUnit: weightUnit("weight_unit"),
    // Comparison-only canonical weight. Every unit named, no ELSE (2.5).
    weightKg: numeric("weight_kg", {
      precision: 10,
      scale: 4,
    }).generatedAlwaysAs(
      sql`weight * CASE weight_unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END`,
    ),
    durationSeconds: integer("duration_seconds"),
    distance: numeric("distance", { precision: 9, scale: 3 }),
    distanceUnit: distanceUnit("distance_unit"),
    // Comparison-only canonical distance. Every unit named, no ELSE (2.5).
    distanceM: numeric("distance_m", {
      precision: 12,
      scale: 4,
    }).generatedAlwaysAs(
      sql`distance * CASE distance_unit WHEN 'M' THEN 1 WHEN 'KM' THEN 1000 WHEN 'MI' THEN 1609.344 WHEN 'FT' THEN 0.3048 END`,
    ),
    completed: boolean("completed"),
    rpe: numeric("rpe", { precision: 3, scale: 1 }),
    kind: setType("kind").notNull().default("NORMAL"),
    // The working set this one extends (drop set, myo-rep, ...). One level
    // deep by intent; that is not a CHECK and is enforced by the writer (2.8).
    parentSetId: uuid("parent_set_id").references(
      (): AnyPgColumn => sessionSets.id,
      { onDelete: "cascade" },
    ),
    notes: text("notes"),
    // Sent by the device when the lifter logged it; see performed_at.
    loggedAt: timestamptz("logged_at").notNull().defaultNow(),
  },
  (t) => [
    // DEFERRABLE INITIALLY DEFERRED in the database -- see the header.
    // Deleting a set renumbers the survivors in one transaction (8.2).
    unique("session_sets_session_exercise_id_set_number_key").on(
      t.sessionExerciseId,
      t.setNumber,
    ),
    check("session_sets_set_number_check", sql`${t.setNumber} >= 1`),
    check("session_sets_reps_check", sql`${t.reps} >= 0`),
    check("session_sets_weight_check", sql`${t.weight} >= 0`),
    check(
      "session_sets_duration_seconds_check",
      sql`${t.durationSeconds} >= 0`,
    ),
    check("session_sets_distance_check", sql`${t.distance} >= 0`),
    check("session_sets_rpe_check", sql`${t.rpe} BETWEEN 0 AND 10`),
    // Without these, a weight with no unit makes weight_kg NULL and silently
    // drops out of every aggregate.
    check(
      "session_sets_weight_unit_check",
      sql`${t.weight} IS NULL OR ${t.weightUnit} IS NOT NULL`,
    ),
    check(
      "session_sets_distance_unit_check",
      sql`${t.distance} IS NULL OR ${t.distanceUnit} IS NOT NULL`,
    ),
    // A set records something. RPE alone is not a set.
    check(
      "session_sets_has_value_check",
      sql`num_nonnulls(${t.reps}, ${t.weight}, ${t.durationSeconds}, ${t.distance}, ${t.completed}) > 0`,
    ),
  ],
);
