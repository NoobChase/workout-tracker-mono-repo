# Worked example — rows and links

Concrete data for [`data-model.md`](data-model.md), following one user through
creating a program and then training partway through a session. Every id below
is consistent; the FK chains resolve.

**The ids are written as small integers for readability only.** Real ids are
UUIDv7 values minted in application code (§2.11 of the data model) — `1`, `11`,
`33` here stand in for `019...` strings that would make every table below
unreadable. The arithmetic in §1.2 works because the rows were created in order,
which UUIDv7 preserves; it is a reading aid, not something to rely on in code.

---

## Part 1 — Creating "Summer Strength"

Chase wants 12 cycles of Push / Back / Legs.

### 1.1 What already exists

**`users`**

| id | clerk_user_id | default_weight_unit | deleted_at |
|---|---|---|---|
| 1 | `user_2xK9pQr…` | `LB` | `NULL` |

**`exercises`** — `owner_user_id NULL` ships with the app; 20 is his own.

| id | owner_user_id | name | muscle_group | is_active |
|---|---|---|---|---|
| 10 | `NULL` | Barbell Bench Press | chest | t |
| 11 | `NULL` | Overhead Press | shoulders | t |
| 12 | `NULL` | Barbell Row | back | t |
| 13 | `NULL` | Pull-up | back | t |
| 14 | `NULL` | Back Squat | legs | t |
| 20 | **1** | Lat Pulldown | back | t |

**`exercise_metrics`** — what each one tracks.

| exercise_id | metric | is_required |
|---|---|---|
| 12 | `REPS` | t |
| 12 | `WEIGHT` | t |
| 13 | `REPS` | t |
| 13 | `WEIGHT` | **f** |
| 20 | `REPS` | t |
| 20 | `WEIGHT` | t |

Exercise 13 is the interesting row: a pull-up requires reps but weight is
optional, so the logger shows a weight field that may be left blank — that is
how "bodyweight, or bodyweight plus plates" is expressed without a second
exercise.

**`user_exercise_settings`** — persists across every program, forever.

| id | user_id | exercise_id | setup | cues | default_weight_unit |
|---|---|---|---|---|---|
| 1 | 1 | 12 | `Pins on 4` | `chest up, pull to the hip` | `NULL` |

`default_weight_unit NULL` means fall back to `users.default_weight_unit` = `LB`.

### 1.2 The program and its cycles

**`workout_programs`**

| id | user_id | name | status | target_cycles | start_date |
|---|---|---|---|---|---|
| 1 | 1 | Summer Strength | `ACTIVE` | **12** | 2026-09-07 |

**`workout_plans`** — one row per cycle. Twelve rows, not one.

| id | program_id | cycle_number |
|---|---|---|
| 1 | 1 | 1 |
| 2 | 1 | 2 |
| 3 | 1 | 3 |
| 4 | 1 | 4 |
| … | … | … |
| 12 | 1 | 12 |

`target_cycles = 12` makes this a **fixed** program: all twelve cycles are
materialized now, the UI reads "cycle 4 of **12**" straight off the column, and
finishing cycle 12 sets `status = 'COMPLETED'` and offers "run another cycle?" —
which clones a cycle *and* bumps `target_cycles` to 13, so the denominator stays
true.

Had Chase said "I'll just run this until I feel like changing", `target_cycles`
would be `NULL`, exactly **one** `workout_plans` row would exist right now, the
UI would read "cycle 4" with no denominator, and exhausting the program would
silently clone the cycle just finished without ever asking (§2.10).

**`workouts`** — three per cycle, so 36 rows.

| id | plan_id | name | position |
|---|---|---|---|
| 1 | 1 | Push | 0 |
| **2** | **1** | **Back** | **1** |
| 3 | 1 | Legs | 2 |
| 4 | 2 | Push | 0 |
| 5 | 2 | Back | 1 |
| 6 | 2 | Legs | 2 |
| … | … | … | … |
| 10 | 4 | Push | 0 |
| **11** | **4** | **Back** | **1** |
| 12 | 4 | Legs | 2 |

The arithmetic worth internalising: **cycle _N_'s Back day is `workouts.id =
3(N−1)+2`**. Cycle 4's Back day is workout 11 — that is the one Part 2 trains.
Cycle 1's Back day (workout 2) and cycle 4's (workout 11) are *different rows*
with no relationship to each other beyond having been cloned from the same
source. Editing one cannot touch the other.

### 1.3 Back day, cycle 1

**`planned_exercises`** for `workout_id = 2`

| id | workout_id | exercise_id | placeholder_label | position | target_sets | group_key |
|---|---|---|---|---|---|---|
| 4 | 2 | 12 | `NULL` | 0 | 4 | `NULL` |
| 5 | 2 | 13 | `NULL` | 1 | 3 | `NULL` |
| 6 | 2 | **`NULL`** | **`do something that feels good`** | 2 | 3 | `NULL` |

Row 6 is a placeholder: `exercise_id` is null, the label carries the intent, and
the `CHECK (num_nonnulls(exercise_id, placeholder_label) = 1)` guarantees exactly
one of the two is set.

**`planned_sets`** — all three prescription states in one day.

| id | planned_exercise_id | set_number | reps_min | reps_max | target_weight | weight_unit | target_weight_kg |
|---|---|---|---|---|---|---|---|
| 1 | 4 | 1 | 8 | 12 | 135.00 | `LB` | 61.2350 |
| 2 | 4 | 2 | 8 | 12 | 135.00 | `LB` | 61.2350 |
| 3 | 4 | 3 | 6 | 10 | 155.00 | `LB` | 70.3068 |
| 4 | 6 | 1 | 10 | 15 | `NULL` | `NULL` | `NULL` |

- **Barbell Row** (`pe 4`): `target_sets = 4` but only sets 1–3 prescribed. Set 4
  is freeform — do it, log whatever happened.
- **Pull-up** (`pe 5`): no `planned_sets` rows at all. "Do 3 sets."
- **Placeholder** (`pe 6`): reps prescribed, weight deliberately null — the
  weight cannot be known until the exercise is.

`target_weight_kg` is generated, never written.

### 1.4 Cloning cycles 2–12

Cycle 1 is built once, then the clone primitive runs 11 times. Nothing is
shared: cycle 4's Back day gets its own rows.

| Table | Cycle 1 ids | Cycle 4 ids |
|---|---|---|
| `workout_plans` | 1 | 4 |
| `workouts` (Back) | 2 | 11 |
| `planned_exercises` | 4, 5, 6 | **31, 32, 33** |
| `planned_sets` | 1, 2, 3, 4 | 121, 122, 123, 124 |

Whole program, materialized: 1 program + 12 plans + 36 workouts + 108 planned
exercises + ~144 planned sets ≈ **300 rows**. The entire legacy database was
~1,700.

---

## Part 2 — Back day, cycle 4, in progress

It is 2026-09-05. Chase opens the app.

### 2.1 "What's next?"

Cycles 1–3 are fully logged, cycle 4's Push day is done. The query returns:

| workouts.id | name | cycle_number |
|---|---|---|
| 11 | Back | 4 |

### 2.2 Starting the workout writes exactly one row

**`workout_sessions`**

| id | user_id | workout_id | performed_at | status |
|---|---|---|---|---|
| 1 | 1 | **11** | 2026-09-05 17:42 | `IN_PROGRESS` |

No `session_exercises`, no `session_sets`. The screen is rendered by joining
`planned_exercises` (31, 32, 33) to a log that is still empty.

### 2.3 Barbell Row — done, with a warmup and a bonus set

**`session_exercises`**

| id | session_id | exercise_id | planned_exercise_id | position | substitution_note |
|---|---|---|---|---|---|
| 1 | 1 | 12 | 31 | 0 | `NULL` |

**`session_sets`** for `session_exercise_id = 1`

| id | set_number | reps | weight | unit | weight_kg | kind | parent_set_id |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 10 | 95.00 | `LB` | 43.0913 | **`WARMUP`** | `NULL` |
| 2 | 2 | 12 | 135.00 | `LB` | 61.2350 | `NORMAL` | `NULL` |
| 3 | 3 | 10 | 135.00 | `LB` | 61.2350 | `NORMAL` | `NULL` |
| 4 | 4 | 8 | 155.00 | `LB` | 70.3068 | `NORMAL` | `NULL` |
| 5 | 5 | 6 | 155.00 | `LB` | 70.3068 | `NORMAL` | `NULL` |

Five rows, **four working sets** — the warmup is excluded by
`kind <> 'WARMUP'`. That matches `target_sets = 4`, even though only three sets
were prescribed: set 5 is the freeform fourth.

Worth being explicit about: **`set_number` is a flat sequence, not the working-set
ordinal the user sees.** Row 4 is "working set 3" on screen. `set_number` exists
to be stable and unique; the display ordinal is derived.

The `LB` in every row was resolved by the **client** and sent explicitly —
sets are logged offline, so the client applies the §2.5 rule against the
settings it cached at session start: `user_exercise_settings` has no override
for exercise 12, so it fell through to `users.default_weight_unit` = `LB`. The
server runs the same `COALESCE` only as a fallback for writes that arrive
without a unit (§2.11 of the data model, §4.3 of `operations.md`).

### 2.4 Pull-up → substituted, and mid-exercise

The pull-up bar is occupied. Chase does lat pulldowns instead.

**`session_exercises`**

| id | session_id | exercise_id | planned_exercise_id | position | substitution_note |
|---|---|---|---|---|---|
| 2 | 1 | **20** | **32** | 1 | `pull-up bar taken` |

`exercise_id = 20` (Lat Pulldown) but `planned_exercise_id = 32` points at the
planned **Pull-up**. The two disagreeing is the entire substitution record —
no flag column, and the plan row is untouched.

**`session_sets`** for `session_exercise_id = 2`

| id | set_number | reps | weight | unit | weight_kg | kind | parent_set_id |
|---|---|---|---|---|---|---|---|
| 6 | 1 | 12 | 100.00 | `LB` | 45.3592 | `NORMAL` | `NULL` |
| 7 | 2 | 10 | 120.00 | `LB` | 54.4311 | `NORMAL` | `NULL` |
| 8 | 3 | 8 | 90.00 | `LB` | 40.8233 | **`DROP`** | **7** |

Set 8 is a drop off set 7, not a set of its own. Three rows, **two working
sets** — the drop is excluded by `parent_set_id IS NULL`. Against
`target_sets = 3`, Chase has one working set left to go.

### 2.5 The placeholder — untouched

`planned_exercises` row 33 has **no `session_exercises` row**. That absence is
the only representation of "not reached yet", and after the session is closed it
becomes the representation of "skipped". Nothing was pre-created, so there is no
empty row to disambiguate.

### 2.6 The full chain for one row

Every link from that drop set back to the user, both sides:

```
session_sets #8            DROP, 8 reps @ 90 lb
  ├─ parent_set_id ───────> session_sets #7           10 @ 120 lb  (the working set)
  └─ session_exercise_id ─> session_exercises #2
        ├─ exercise_id ────────> exercises #20        "Lat Pulldown" (owner_user_id 1)
        │                            └─ exercise_metrics: REPS(req), WEIGHT(req)  [PK (exercise_id, metric)]
        ├─ planned_exercise_id ─> planned_exercises #32   Pull-up, target_sets 3
        │        └─ workout_id ─> workouts #11        "Back", position 1
        │              └─ plan_id ─> workout_plans #4     cycle_number 4
        │                    └─ program_id ─> workout_programs #1  "Summer Strength"
        │                                          └─ user_id ─> users #1
        └─ session_id ─────────> workout_sessions #1  IN_PROGRESS, 2026-09-05
                                       ├─ workout_id ─> workouts #11   (same row ↑)
                                       └─ user_id ────> users #1
```

The two paths — plan side and log side — meet at `workouts #11`. That join is
what makes plan-versus-actual answerable, and it is exactly what the legacy
schema lacked: it had only repeated name strings, so a renamed plan or a
reordered exercise silently broke the correspondence.

### 2.7 What the screen shows right now

A `LEFT JOIN` from the plan side, **unioned with the exercises that have no
plan row at all**, counting only sets that count:

```sql
-- planned rows, with whatever has been logged against them
SELECT FALSE                                  AS unplanned,
       pe.position                            AS position,
       COALESCE(e.name, pe.placeholder_label) AS planned,
       pe.target_sets,
       ae.name                                AS actually_did,
       COUNT(ss.id) FILTER (
         WHERE ss.parent_set_id IS NULL AND ss.kind <> 'WARMUP'
       )                                      AS working_sets
FROM planned_exercises pe
LEFT JOIN exercises          e  ON e.id  = pe.exercise_id
LEFT JOIN session_exercises  se ON se.planned_exercise_id = pe.id
                                AND se.session_id = $session
LEFT JOIN exercises          ae ON ae.id = se.exercise_id
LEFT JOIN session_sets       ss ON ss.session_exercise_id = se.id
WHERE pe.workout_id = $workout
GROUP BY pe.position, e.name, pe.placeholder_label, pe.target_sets, ae.name

UNION ALL

-- improvised: a session row with no planned row to hang off
SELECT TRUE, se.position, NULL, NULL, ae.name,
       COUNT(ss.id) FILTER (
         WHERE ss.parent_set_id IS NULL AND ss.kind <> 'WARMUP'
       )
FROM session_exercises se
JOIN      exercises    ae ON ae.id = se.exercise_id
LEFT JOIN session_sets ss ON ss.session_exercise_id = se.id
WHERE se.session_id = $session
  AND se.planned_exercise_id IS NULL
GROUP BY se.position, ae.name

ORDER BY unplanned, position;
```

| unplanned | position | planned | target_sets | actually_did | working_sets |
|---|---|---|---|---|---|
| f | 0 | Barbell Row | 4 | Barbell Row | 4 |
| f | 1 | Pull-up | 3 | **Lat Pulldown** | 2 |
| f | 2 | do something that feels good | 3 | `NULL` | 0 |

Complete, substituted-and-in-progress, and not-started — three states, no status
column anywhere.

**The `UNION ALL` is not optional.** An earlier draft was the plan-side `LEFT
JOIN` alone, which is subtly broken: §4.8 of `operations.md` says an improvised
exercise is a `session_exercises` row with `planned_exercise_id IS NULL`, and a
join *from* `planned_exercises` can never produce one. So the schema supported
going off-script and the logging screen silently would not have shown it — the
user would add face pulls, log three sets, and watch them vanish. Chase's session
has none right now, which is exactly why the bug survived being written down.

Two smaller things to copy: `COUNT(ss.id) FILTER (…)` rather than `COUNT(*)`,
because the `LEFT JOIN` produces a row even when nothing is logged and `COUNT(*)`
would report 1 instead of 0; and note that one planned exercise split across two
session rows (§8 of the data model — half on the barbell, half on dumbbells)
correctly yields two rows here, since there is no unique on
`(session_id, planned_exercise_id)`.

### 2.8 Finishing

Chase does his last pulldown set, picks face pulls for the placeholder, and
closes the workout:

| Table | Rows added |
|---|---|
| `session_sets` | #9 — `se 2`, set_number 4, working set 3 of 3 |
| `session_exercises` | #3 — `exercise_id` = face pulls, `planned_exercise_id` = **33** |
| `session_sets` | #10, #11, #12 — three sets under `se 3` |

Then one update:

```sql
UPDATE workout_sessions SET status = 'COMPLETED' WHERE id = 1;
```

That single write is what advances §4.1 — "what's next?" now returns
`workouts #12`, Legs, cycle 4. Had he skipped the day instead, the row would be
`SKIPPED`, which the query also treats as resolved; writing no row at all would
leave Back day permanently next and wedge the program behind it.

### 2.9 What cycle 5 looks like afterwards

Nothing. Cycle 5's Back day is `workouts #14` with its own
`planned_exercises` — still prescribing a **Pull-up**, because a substitution is
a fact about one session, never an edit to the plan.

If Chase wants pulldowns from now on, that is a deliberate "apply to cycles
5–12" (§3.8 of `operations.md`). Two things bound it: cycles with logged sessions
refuse to be replaced, enforced by the database via `ON DELETE RESTRICT`; and
cycles he has deliberately authored to be different — say a deload at cycle 9 —
are detected and skipped rather than silently overwritten, which the database
cannot enforce and the application must.
