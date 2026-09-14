# Observations

Anything labelled **(inference)** is drawn from the 5-row-per-table sample, not
the full data, and must be re-checked before it is relied on. Anything else is
read straight from the schema.

## Nullability vs. actual data

- **Everything except `id` is `DEFAULT NULL`**, but several columns are almost
  certainly never null in practice:
  - `data.submissionTime`, `data.user`, `data.exercise`, `data.sets` — populated
    in every sample row (inference). The app has no meaningful use for a log row
    without these.
  - `data.repsSetN` / `data.weightSetN` — never `NULL` in the sample; unused
    sets are the **empty string `''`**, not `NULL` (inference). So the schema
    permits `NULL` but the app writes `''`.
  - `users.workoutPlan` — never `NULL` in the sample; "no plan" is the **empty
    string `''`** (inference).
  - `users.username`, `users.password` — populated in every sample row
    (inference), though `password` is sometimes a single space.
- **`workoutPlans.workoutPlan_id` and `workoutPlans.workoutDay_id`** are the only
  non-key `NOT NULL` columns — yet they point at tables that don't exist.

## Columns that look unused, constant, or empty

- **`exerciseList.muscleGroup`** — `NULL` in all 5 sample rows. Strong candidate
  for a declared-but-never-populated column (inference; confirm with
  `SELECT COUNT(muscleGroup) FROM exerciseList`).
- **`data.weightSetN` / `data.repsSetN` for high N** — `repsSet6` / `weightSet6`
  (and likely 5) are empty in nearly every row; the 6-set width looks like
  headroom that is rarely used (inference).
- **`users.password` = `" "`** — several accounts have a single-space password,
  i.e. effectively no authentication (inference).
- Plan/exercise names like `TestPlan`, `test2`, and users `test` / `Guest`
  suggest a meaningful fraction of rows are scratch data, not real training
  history.

## Denormalization and duplicated data

This is the dominant problem with the schema.

- **`data` and `workoutPlans` are parallel wide tables** sharing seven
  identically named columns (`user, workoutPlan, workoutDayOrder, workoutDay,
  exercise, order, sets`). The plan structure is effectively copied into every
  log row.
- **User, plan, day, and exercise are stored as repeated strings** on every row
  of `data`, `workoutPlans`, and `exerciseList` instead of foreign keys to
  `users.id` and to (missing) plan / day / exercise tables. A rename anywhere
  requires a mass `UPDATE` across tables and silently breaks historical
  alignment if missed.
- **`repsSet1..6` + `weightSet1..6`** is a 12-column repeating group — a
  first-normal-form violation. Sets should be rows in a child table
  (`set_number, reps, weight`), which also removes the fixed cap of 6 and the
  `''`-means-absent convention.
- **`data.sets` / `workoutPlans.sets`** is a derived count (number of populated
  set columns) stored redundantly and kept in sync by the app.
- **`users.workoutPlan` + `users.nextWorkout`** duplicate state that is
  otherwise derivable from `workoutPlans` + the log.

## Inconsistent naming

- Owner column is **`user`** in `data`, `exerciseList`, `workoutPlans` but
  **`username`** in `users`.
- **`order`** is a SQL reserved word used as a column name in two tables.
- **`workoutPlan`** is a string name in four places, while **`workoutPlan_id`**
  (a number) also exists — same concept, two representations.
- Table names have no convention: `data` (singular, generic, meaningless),
  `users` (plural), `exerciseList` (singular + "List" suffix, camelCase),
  `workoutPlans` (plural, camelCase). `data` in particular tells a reader
  nothing — it is the workout/set log.
- `workoutDay` values are inconsistently cased in real data (`Chest` vs `push`).

## Stored as string, should be a typed column

| Column(s) | Current type | Should be |
|-----------|--------------|-----------|
| `data.repsSet1..6` | `varchar(45)` | `INT` (or `SMALLINT`), `NULL` for absent |
| `data.weightSet1..6` | `varchar(45)` | `DECIMAL(6,2)` (plates use halves/quarters), `NULL` for absent, plus an explicit unit column or a fixed documented unit |
| `users.password` | `varchar(45)` plaintext | password **hash** column (`CHAR(60)`/`VARBINARY`), never the raw password |
| `users.workoutPlan` | `varchar(45)` | FK `current_plan_id INT` → plans table, `NULL` when none |
| `users.nextWorkout` | `int` (bare index) | FK to a `workout_day` row, or a computed value |
| `data.workoutDay` / `workoutPlans.workoutDay` | `varchar(45)` free text | FK to a `workout_day` table; the day *name* lives there once |
| `exerciseList.muscleGroup` | `varchar(45)` | enum / FK to a `muscle_groups` table (if kept at all) |
| `exerciseList.exercise`, `data.exercise`, `workoutPlans.exercise` | `varchar(45)` | FK `exercise_id` → exercises table |
| dates embedded in `users.workoutPlan` name (`"... 1/20/24"`) | inside a name string | a real `DATE` column if the plan has an effective date |

Also: `varchar(45)` is too narrow for `exerciseList.notes` and `settings` —
real notes are already **truncated mid-sentence**. That data loss has already
happened and cannot be recovered; the new column should be `TEXT` /
`VARCHAR(500)+`.

## Credentials and personal data (handle deliberately)

- **`users.password` — plaintext passwords.** Must not be carried across as-is.
  The new system should force a reset (store only hashes) or, at minimum, hash
  on first login. Do not copy this column into any new table, backup, or fixture.
- **`users.username`** — personal identifiers (real first names in the real
  data). Low sensitivity but still PII.
- **`exerciseList.notes` / `settings`, `data`** — personal training notes and
  history. Not sensitive, but user-owned; tie to a real user FK with proper
  delete-cascade.
- No email addresses, no payment data, no tokens found in the schema.

## Tables that appear abandoned or half-built

- **No table is fully abandoned** — all four have recent-ish data (2022
  timestamps in `data`).
- **The plan/day normalization is half-built:** `workoutPlans.workoutPlan_id` /
  `workoutDay_id` reference `workout_plan` / `workout_day` tables that do not
  exist in this database. Either they were dropped or never created. The IDs are
  dead weight as things stand.
- **`exerciseList`** may be near-abandoned in practice — the sample shows a
  single user and a mostly-empty table; worth checking how many users have any
  rows.

## Recommendation: redesign, do not port

The four tables should be **replaced with a normalized model**, not migrated
structurally. Only the *values* should be carried over (via a one-off
transform), and some — plaintext passwords, obvious test rows — should be
dropped.

### Why

1. **No foreign keys, no unique constraints, no indexes beyond the PK.** The
   database enforces almost nothing and every real query is a table scan.
   Porting the tables ports all of that.
2. **String-keyed relationships under a case-insensitive collation** produce
   real bugs today (`Alyssa`/`alyssa` both match one login; renames break
   history).
3. **Repeating groups (`repsSet1..6` / `weightSet1..6`) and the `data` ⇄
   `workoutPlans` column overlap** make even simple questions ("best set on
   bench this month") awkward and force logic into the app.
4. **Plaintext passwords** must be handled as a deliberate security step, not
   copied.
5. **The half-built `workoutPlan_id` / `workoutDay_id`** shows the original
   design already knew it needed plan and day entities.

### Target shape (sketch for the schema designer)

- `users(id, username CITEXT/lower UNIQUE, password_hash, created_at)` — hash,
  unique, drop `workoutPlan` / `nextWorkout` denorm.
- `exercises(id, owner_user_id NULL, name, muscle_group, setup_notes TEXT,
  form_cues TEXT)` — replaces `exerciseList`; `NULL` owner = shared/global.
- `workout_plans(id, user_id FK, name, created_at)` — `UNIQUE(user_id, name)`.
  (materializes `workoutPlan_id`)
- `workout_days(id, plan_id FK, name, position)` — `UNIQUE(plan_id, position)`.
  (materializes `workoutDay_id`)
- `plan_exercises(id, day_id FK, exercise_id FK, position, target_sets)` —
  replaces `workoutPlans` rows.
- `workout_sessions(id, user_id FK, plan_id FK NULL, day_id FK NULL,
  performed_at)` — replaces the shared `submissionTime`.
- `session_entries(id, session_id FK, exercise_id FK, position)` — one per
  exercise performed.
- `session_sets(id, entry_id FK, set_number, reps INT NULL, weight DECIMAL(6,2)
  NULL, weight_unit)` — replaces `repsSetN` / `weightSetN`; absent sets are
  simply missing rows.
- Index every FK; add `(user_id, performed_at)` on sessions.
- Track `nextWorkout` either as `users.current_plan_id` + a computed "next day",
  or a small `user_plan_progress(user_id, plan_id, next_day_id)` row.

### What is safe to keep close to as-is

- The *concepts* — plan → days → exercises → target sets, and session → entries
  → performed sets — map cleanly onto the sketch above.
- `exerciseList.settings` / `notes` text content (migrate the strings; the
  pre-truncated data is already lost).
- The timestamp values in `data`.
