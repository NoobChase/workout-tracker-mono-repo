# Relationships

## Enforced foreign keys

**None.** No table declares a `FOREIGN KEY` constraint. Each `CREATE TABLE` has
only `PRIMARY KEY (\`id\`)`. The dump sets `FOREIGN_KEY_CHECKS=0` as boilerplate,
but there are no FK definitions anywhere.

Consequences:

- Deleting a `users` row orphans its `data`, `workoutPlans`, and `exerciseList`
  rows silently. The `users` sample already has id gaps (1, 2, 8, 9, 10), so
  deletions have occurred; whether matching child rows were cleaned up by the
  app is unknown.
- Nothing prevents a `data` / `workoutPlans` / `exerciseList` row referencing a
  username, plan, day, or exercise that does not exist.

## Implied relationships (not enforced)

These are inferred from column names and the sample data. **This is where the
design problems concentrate** — every join below is a string match against an
unindexed, non-unique column, or against a surrogate id whose parent table
does not exist.

### 1. User ownership — string join on username

| From | Column | To | Column |
|------|--------|----|--------|
| `data` | `user` | `users` | `username` |
| `exerciseList` | `user` | `users` | `username` |
| `workoutPlans` | `user` | `users` | `username` |

Join key is `varchar(45)`, nullable, **not unique** on either side, compared
under a **case- and accent-insensitive** collation. `users` holds both `Alyssa`
and `alyssa`; a lookup by either name matches both rows, and child rows written
as `user = 'alyssa'` are ambiguous as to owner. `Guest` is a shared account.
The column is `user` in three tables but `username` in `users` (naming drift).

### 2. Current plan pointer

| From | Column | To | Column |
|------|--------|----|--------|
| `users` | `workoutPlan` (+ `id`/`username`) | `workoutPlans` | `workoutPlan` (+ `user`) |

`users.workoutPlan` names the plan the user currently has selected. It must be
matched together with the user, because plan names are only unique per user (if
that). Empty string `''` means "no plan selected".

### 3. `users.nextWorkout` → day sequence position

| From | Column | To | Column |
|------|--------|----|--------|
| `users` | `nextWorkout` | `workoutPlans` | `workoutDayOrder` (within the user's current plan) |

Inference: `nextWorkout` is an integer index into the ordered set of distinct
`workoutDay` values for the user's current plan. The app presumably increments
it (wrapping) after each logged session. Not verifiable from the sample alone.

### 4. Log ↔ template — the parallel-tables relationship

| From | Columns | To | Columns |
|------|---------|----|---------|
| `data` | `(user, workoutPlan, workoutDay, exercise)` and `workoutDayOrder`, `order` | `workoutPlans` | `(user, workoutPlan, workoutDay, exercise)` and `workoutDayOrder`, `order` |

`data` is the "what I actually did" log for the plan defined in `workoutPlans`.
The two tables share seven identically named columns
(`user, workoutPlan, workoutDayOrder, workoutDay, exercise, order, sets`).
`data` adds `submissionTime` and the 12 per-set columns; `workoutPlans` adds
`workoutPlan_id` / `workoutDay_id`. There is **no id-based link** between a log
row and the template row it came from — only the repeated strings. If a plan is
renamed or an exercise reordered, historical `data` rows no longer line up.

### 5. Exercise name → `exerciseList`

| From | Column | To | Column |
|------|--------|----|--------|
| `data` | `(user, exercise)` | `exerciseList` | `(user, exercise)` |
| `workoutPlans` | `(user, exercise)` | `exerciseList` | `(user, exercise)` |

Inference: `exerciseList` is the per-user catalogue that `data.exercise` and
`workoutPlans.exercise` draw from. But the names are not kept consistent —
`exerciseList` has `bench` / `squat` (lower case), while `data` /
`workoutPlans` samples have `Bench`, `Pec Fly`, `bent over row`, `pull up`.
Many performed exercises will have no `exerciseList` entry, and vice versa.

### 6. `workoutPlans.workoutPlan_id` / `workoutDay_id` → missing parent tables

| From | Column | Refers to | Status |
|------|--------|-----------|--------|
| `workoutPlans` | `workoutPlan_id` | a plan entity | **No such table.** Grouping id: constant across all rows of one `(user, workoutPlan)`. |
| `workoutPlans` | `workoutDay_id` | a day entity | **No such table.** Grouping id: constant across all rows of one `(user, workoutPlan, workoutDay)`. |

Sample evidence: `workoutPlan_id` = 1 for rows 1–3 (`Chase`/`TestPlan`), 2 for
rows 4–5 (`Chase`/`test2`); `workoutDay_id` = 1, 2, 2, 3, 4 respectively. These
are the surrogate keys of `workout_plan` and `workout_day` tables that were
apparently planned but never created (or were dropped). `data` has no
counterpart columns, so the identifiers are unusable for joining the log.
