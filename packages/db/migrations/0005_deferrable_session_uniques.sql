-- Custom migration: Drizzle has no API for DEFERRABLE (spec step 2, decision 7;
-- the same treatment as 0001). Drop-and-add because ALTER CONSTRAINT ...
-- DEFERRABLE rejects non-foreign-key constraints. Same names as schema.ts
-- declares, so the drizzle-kit snapshot still matches. Asserted by
-- test/schema.test.ts.
--
-- session_sets: deleting a logged set renumbers the survivors in one
-- transaction, which trips a non-deferrable unique halfway (data-model.md 8.2).
-- session_exercises: reordering within a session, as for the plan side
-- (data-model.md 3.6).
ALTER TABLE "session_sets"
  DROP CONSTRAINT "session_sets_session_exercise_id_set_number_key",
  ADD CONSTRAINT "session_sets_session_exercise_id_set_number_key"
    UNIQUE ("session_exercise_id", "set_number") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "session_exercises"
  DROP CONSTRAINT "session_exercises_session_id_position_key",
  ADD CONSTRAINT "session_exercises_session_id_position_key"
    UNIQUE ("session_id", "position") DEFERRABLE INITIALLY DEFERRED;
