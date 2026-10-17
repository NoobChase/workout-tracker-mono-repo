-- Custom migration: Drizzle has no API for DEFERRABLE (spec step 2, decision 7).
-- Drop-and-add because ALTER CONSTRAINT ... DEFERRABLE rejects non-foreign-key
-- constraints, Postgres 18 included. Same names as schema.ts declares, so the
-- drizzle-kit snapshot still matches. Asserted by test/schema.test.ts.
--
-- Deferred so a reorder can renumber positions inside one transaction (or one
-- statement) without tripping uniqueness midway (data-model.md 3.5).
ALTER TABLE "workouts"
  DROP CONSTRAINT "workouts_plan_id_position_key",
  ADD CONSTRAINT "workouts_plan_id_position_key"
    UNIQUE ("plan_id", "position") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "planned_exercises"
  DROP CONSTRAINT "planned_exercises_workout_id_position_key",
  ADD CONSTRAINT "planned_exercises_workout_id_position_key"
    UNIQUE ("workout_id", "position") DEFERRABLE INITIALLY DEFERRED;
