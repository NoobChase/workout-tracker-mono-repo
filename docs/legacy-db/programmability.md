# Programmability

**There are no stored procedures, stored functions, triggers, or scheduled
events in this database.**

Evidence from `legacy-schema.txt`:

```
-- Dumping events for database 'dbname'
--
-- Dumping routines for database 'dbname'
```

Both sections are present and empty. No `CREATE TRIGGER`, `CREATE PROCEDURE`,
`CREATE FUNCTION`, or `CREATE EVENT` appears anywhere in the export. To
re-confirm against the live server:

```sql
SELECT routine_type, routine_name FROM information_schema.routines
  WHERE routine_schema = DATABASE();
SELECT trigger_name, event_object_table FROM information_schema.triggers
  WHERE trigger_schema = DATABASE();
SELECT event_name FROM information_schema.events
  WHERE event_schema = DATABASE();
```

## Business logic that therefore lives in the application

Because the database enforces nothing beyond primary keys and does no
computation, **all of the following is implemented in application code** and
must be reproduced by the replacement system:

- **Authentication.** Username lookup and plaintext password comparison. No
  hashing, no lockout, no uniqueness enforcement — all app-side (and currently
  weak; see `observations.md`).
- **Session grouping.** Writing one `submissionTime` across every `data` row
  saved from a single logged workout.
- **Reps/weight parsing.** The per-set values are stored as strings; converting
  them to numbers, and treating `''` as "set not performed", is done in the app.
- **`sets` bookkeeping.** Keeping `data.sets` / `workoutPlans.sets` in step with
  the number of populated `repsSetN` columns.
- **Ordering.** Assigning and maintaining `workoutDayOrder` and `order`
  (0-based) as the user edits a plan.
- **`nextWorkout` advancement.** Incrementing / wrapping the pointer into the
  plan's day sequence after each session.
- **`workoutPlan_id` / `workoutDay_id` assignment.** Allocating and reusing
  these grouping ids when plan rows are created — there is no parent table and
  no `AUTO_INCREMENT` to lean on, so the app computes them.
- **Referential integrity.** Cascading (or not) when a user, plan, day, or
  exercise is deleted or renamed. Keeping the repeated name strings in `data`
  and `workoutPlans` consistent with each other and with `users` /
  `exerciseList`.
- **Plan → log linkage.** Matching a performed exercise back to its template
  row by comparing name strings, since there is no id relationship.
