# Tables

Four tables, all `ENGINE=InnoDB`, `DEFAULT CHARSET=utf8mb4`,
`COLLATE=utf8mb4_0900_ai_ci`. Every table's only key is a surrogate
`id int NOT NULL AUTO_INCREMENT PRIMARY KEY`. There are no other `NOT NULL`
columns except `workoutPlans.workoutPlan_id` and `workoutPlans.workoutDay_id`.
Every non-key column is `DEFAULT NULL`.

## Row counts (inferred)

Exact `COUNT(*)` was not available. The figures below are the `AUTO_INCREMENT`
value from the schema dump, which is an **upper bound** on rows ever inserted
(the true count is lower wherever rows were deleted — the `users` sample shows
id gaps, so deletion has happened).

| Table | AUTO_INCREMENT | Approx. current rows |
|-------|---------------:|---------------------|
| `data` | 1178 | up to ~1177 |
| `exerciseList` | 250 | up to ~249 |
| `users` | 29 | up to ~28 (fewer — sample ids are 1, 2, 8, 9, 10) |
| `workoutPlans` | 248 | up to ~247 |

---

## `data`

The **workout log**: one row per exercise performed in a session, holding the
per-set reps and weight. Multiple rows from one session share a
`submissionTime`.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | `int` | NO | — | Identity, `AUTO_INCREMENT`, PK. |
| `submissionTime` | `datetime` | YES | `NULL` | Session timestamp, `YYYY-MM-DD HH:MM:SS`. Shared across all rows of one logged session (inference from sample). |
| `user` | `varchar(45)` | YES | `NULL` | Username string; not an FK. Matches `users.username` (inference). |
| `workoutPlan` | `varchar(45)` | YES | `NULL` | Plan name string; not an FK. |
| `workoutDayOrder` | `int` | YES | `NULL` | 0-based index of the day within the plan (inference — values 0, 1 in sample). |
| `workoutDay` | `varchar(45)` | YES | `NULL` | Day name, e.g. `Chest`, `Back`. |
| `exercise` | `varchar(45)` | YES | `NULL` | Exercise name, free text. |
| `order` | `int` | YES | `NULL` | 0-based position of the exercise within the day (inference). **Reserved word** — always needs backticks. |
| `sets` | `int` | YES | `NULL` | Number of sets performed; equals the count of populated `repsSetN` columns in the sample. |
| `repsSet1`..`repsSet6` | `varchar(45)` | YES | `NULL` | Reps for sets 1–6, stored as **strings of digits**; empty string `''` (not `NULL`) for unused sets. |
| `weightSet1`..`weightSet6` | `varchar(45)` | YES | `NULL` | Weight for sets 1–6, stored as **strings**; `'0'` seen; empty string `''` for unused sets. Unit not recorded. |

`repsSet1..6` and `weightSet1..6` are a 12-column repeating group — see
`observations.md`.

---

## `exerciseList`

A **per-user exercise notebook**: setup details and form cues for named
exercises.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | `int` | NO | — | Identity, `AUTO_INCREMENT`, PK. |
| `user` | `varchar(45)` | YES | `NULL` | Username string; not an FK. |
| `exercise` | `varchar(45)` | YES | `NULL` | Exercise name, free text. Lower-case in sample (`bench`, `squat`). |
| `muscleGroup` | `varchar(45)` | YES | `NULL` | **`NULL` in all 5 sample rows** — possibly unused (inference; verify against full data). |
| `settings` | `varchar(45)` | YES | `NULL` | Equipment setup notes, e.g. rack pin heights (`"J cups 14 and safety bar 5"`). Free text. |
| `notes` | `varchar(45)` | YES | `NULL` | Form cues. The `varchar(45)` limit **truncates** real values mid-sentence (see `observations.md`). |

---

## `users`

Login and current-plan state.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | `int` | NO | — | Identity, `AUTO_INCREMENT`, PK. |
| `username` | `varchar(45)` | YES | `NULL` | Login name. No unique constraint. Sample contains both `Alyssa` and `alyssa` as separate rows — under the case-insensitive collation a login lookup matches both (see `observations.md`). |
| `password` | `varchar(45)` | YES | `NULL` | **Plaintext password.** Sample values are short (`"pass"`, `"gg"`) or a single space `" "`. See `observations.md` — credentials. |
| `workoutPlan` | `varchar(45)` | YES | `NULL` | Name of the user's currently selected plan; empty string `''` (not `NULL`) when none. One sample value embeds a date: `"Will Get Gainz 1/20/24"`. |
| `nextWorkout` | `int` | YES | `NULL` | Pointer to the next day in the current plan's day sequence — matches `workoutDayOrder` (inference). `0` when no plan. |

---

## `workoutPlans`

The **plan template**: one row per exercise scheduled on a plan day.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | `int` | NO | — | Identity, `AUTO_INCREMENT`, PK. |
| `user` | `varchar(45)` | YES | `NULL` | Username string; not an FK. |
| `workoutPlan` | `varchar(45)` | YES | `NULL` | Plan name string. |
| `workoutDayOrder` | `int` | YES | `NULL` | 0-based index of the day within the plan. |
| `workoutDay` | `varchar(45)` | YES | `NULL` | Day name. |
| `exercise` | `varchar(45)` | YES | `NULL` | Exercise name. |
| `order` | `int` | YES | `NULL` | 0-based position of the exercise within the day. **Reserved word.** |
| `sets` | `int` | YES | `NULL` | Target number of sets. |
| `workoutPlan_id` | `int` | **NO** | — | Surrogate id grouping all rows of one `(user, workoutPlan)`. **No parent table exists** (inference from sample: rows 1–3 share `1`). |
| `workoutDay_id` | `int` | **NO** | — | Surrogate id grouping all rows of one `(user, workoutPlan, workoutDay)`. **No parent table exists** (inference: rows 2–3 share `2`). |

`workoutPlan_id` / `workoutDay_id` look like the start of a normalization that
was never finished — the `data` table has no equivalent columns. See
`relationships.md` and `observations.md`.
