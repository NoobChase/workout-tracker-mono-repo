# Sample Data

**These rows are synthesized, not copied.** They preserve the shape, formats,
and realistic value ranges of the real export, but every username, password,
and free-text note has been replaced with a fabricated equivalent. No real
email address, password, or personal identifier is reproduced here.

The real export only provided 5 rows per table (`WHERE 1 LIMIT 5`), so the
patterns below are drawn from a small sample — treat them as indicative, not
exhaustive.

---

## `data`

Five exercises from two logged sessions. Rows saved together in one session
share `submissionTime`.

| id | submissionTime | user | workoutPlan | workoutDayOrder | workoutDay | exercise | order | sets | repsSet1..6 | weightSet1..6 |
|----|----------------|------|-------------|----------------:|------------|----------|------:|-----:|-------------|---------------|
| 201 | 2022-05-11 18:22:10 | Guest | Bro Split | 0 | Chest | Pec Fly | 2 | 3 | `12,12,10,'','',''` | `35,35,35,'','',''` |
| 202 | 2022-05-11 18:22:10 | Guest | Bro Split | 0 | Chest | Bench | 0 | 4 | `8,8,6,4,'',''` | `135,155,165,165,'',''` |
| 203 | 2022-05-11 18:22:10 | Guest | Bro Split | 0 | Chest | Dips | 1 | 3 | `12,8,8,'','',''` | `0,35,35,'','',''` |
| 204 | 2022-05-13 07:41:55 | riley | Bro Split | 1 | Back | bent over row | 1 | 3 | `12,10,8,'','',''` | `95,115,135,'','',''` |
| 205 | 2022-05-13 07:41:55 | riley | Bro Split | 1 | Back | pull up | 0 | 5 | `12,8,8,4,3,''` | `0,25,25,45,45,''` |

Patterns:

- **`submissionTime`** — `YYYY-MM-DD HH:MM:SS`, nullable in schema but populated
  in every sample row. Identical for all rows of one session.
- **`user` / `workoutPlan` / `workoutDay`** — free-text strings repeated on
  every row. `workoutDay` values are title-case body parts (`Chest`, `Back`).
- **`workoutDayOrder`** — small non-negative int, 0-based (`0`, `1` seen).
- **`order`** — small non-negative int, 0-based, **not** matching row order in
  the file (exercises stored in insert order, displayed by `order`).
- **`sets`** — equals the number of non-empty `repsSetN` values in the row.
- **`repsSetN`** — string of digits (`"8"`, `"12"`), or empty string `''` for
  set numbers beyond `sets`. Never `NULL` in the sample. Highest set index seen
  populated: 5.
- **`weightSetN`** — string; digits including `"0"` (e.g. bodyweight or empty
  bar), empty string `''` for unused sets. No decimals seen in the sample but
  the `varchar` allows them. **No unit is stored** (assume lb from the values).

---

## `exerciseList`

Per-user exercise notes.

| id | user | exercise | muscleGroup | settings | notes |
|----|------|----------|-------------|----------|-------|
| 1 | riley | bench | `NULL` | `J cups 14 and safety bar 5` | `Pull the bar apart and keep the elbows tuck` |
| 2 | riley | dips | `NULL` | `NULL` | `engage the chest` |
| 3 | riley | squat | `NULL` | `Pins on 6, catch bar at 4` | `sit back` |
| 4 | riley | tricep extension | `NULL` | `NULL` | `NULL` |
| 5 | riley | curl | `NULL` | `NULL` | `NULL` |

Patterns:

- **`user`** — single value across the sample (`riley` here; `Chase` in the
  real export). Suggests few users actually use this table.
- **`exercise`** — lower-case, free text.
- **`muscleGroup`** — `NULL` in every sample row. Appears unused (verify).
- **`settings`** — equipment setup, mostly rack/pin numbers; often `NULL`.
- **`notes`** — form cues; often `NULL`. Real values are **truncated at 45
  characters** mid-word — the `notes` above is shown truncated to match that
  behaviour.

---

## `users`

| id | username | password | workoutPlan | nextWorkout |
|----|----------|----------|-------------|------------:|
| 1 | riley | `" "` (single space) | `Will Get Gainz 1/20/24` | 4 |
| 2 | Morgan | `sunshine` | `""` (empty string) | 0 |
| 8 | Guest | `" "` (single space) | `Push Pull Legs` | 2 |
| 9 | morgan | `letmein` | `Cardio` | 1 |
| 10 | test | `qa` | `""` (empty string) | 0 |

Patterns:

- **id gaps** — sample ids are 1, 2, 8, 9, 10; rows 3–7 were deleted.
- **`username`** — free text, no unique constraint. `Morgan` and `morgan`
  coexist as separate accounts (mirrors real `Alyssa` / `alyssa`). `Guest` is a
  shared login. `test` is a QA account.
- **`password`** — **plaintext**, 2–8 chars, dictionary words or initials; some
  accounts have just a single space `" "` (effectively no password). See
  `observations.md`.
- **`workoutPlan`** — currently selected plan name, or empty string `""` (never
  `NULL` in the sample) when none. One value embeds a date (`1/20/24`) in the
  name.
- **`nextWorkout`** — small non-negative int; `0` whenever `workoutPlan` is
  empty.

---

## `workoutPlans`

Plan template rows. `workoutPlan_id` groups a plan; `workoutDay_id` groups a
day within it.

| id | user | workoutPlan | workoutDayOrder | workoutDay | exercise | order | sets | workoutPlan_id | workoutDay_id |
|----|------|-------------|----------------:|------------|----------|------:|-----:|---------------:|--------------:|
| 1 | riley | TestPlan | 0 | Legs | squat | 1 | 4 | 1 | 1 |
| 2 | riley | TestPlan | 1 | Chest | bench | 1 | 5 | 1 | 2 |
| 3 | riley | TestPlan | 1 | Chest | dips | 2 | 3 | 1 | 2 |
| 4 | riley | test2 | 0 | push | bench | 0 | 4 | 2 | 3 |
| 5 | riley | test2 | 1 | pull | pull up | 0 | 3 | 2 | 4 |

Patterns:

- **`workoutPlan_id`** — constant for all rows of one `(user, workoutPlan)`;
  increments per plan. No parent table.
- **`workoutDay_id`** — constant for all rows of one
  `(user, workoutPlan, workoutDay)`; globally increasing, not reset per plan. No
  parent table.
- **`workoutDayOrder`** — 0-based; can repeat within a plan for rows that share
  a day (rows 2 and 3 both `1`).
- **`workoutDay`** — casing is inconsistent even within the sample (`Legs`,
  `Chest` vs `push`, `pull`).
- **`order`** — 0-based position within the day.
- **`sets`** — target set count, small positive int.
- Plan names like `TestPlan` / `test2` suggest scratch/experimental data mixed
  in with real plans.
