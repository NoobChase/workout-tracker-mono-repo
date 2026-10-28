# Operations — every user action and where it lands

Companion to [`data-model.md`](data-model.md). Each operation below lists what
the user does, which tables are written, and the SQL where it is not obvious.

---

## 0. Two principles that explain most of this

### 0.1 Session tables record what happened, not what was intended

Nothing in a `session_*` table is created in advance. Starting a workout writes
**one row** (`workout_sessions`); `session_exercises` and `session_sets` appear
only when the user actually logs something. The prescription the user sees on
screen is rendered from the `planned_*` tables, not copied into the log.

That single rule is what makes the three deviations in §8 of the data model
free, with no flags anywhere:

| Deviation | How it looks in the data |
|---|---|
| Skipped an exercise | A `planned_exercises` row with no `session_exercises` row pointing at it |
| Cut sets short | Fewer `session_sets` rows than `planned_sets` / `target_sets` |
| Improvised | A `session_exercises` row with `planned_exercise_id IS NULL` |

The tempting alternative — pre-creating empty rows so the log mirrors the plan —
destroys all three. "Skipped" and "planned but not yet reached" become
indistinguishable, and cutting sets short turns into a `DELETE` with `set_number`
gaps to renumber.

### 0.2 One clone primitive powers three features

Copying a `workout_plans` subtree (plan → workouts → planned exercises →
planned sets) is a single operation used by:

1. **Creating a program** — build cycle 1, then clone it N−1 times (§3.1)
2. **Copy from an old program** — clone that program's cycle 1 into a new program (§3.9)
3. **Apply an edit to remaining cycles** — clone the edited cycle over cycles n+1…N (§3.8)

Write it once. Everything about materialized cycles (§2.1 of the data model)
depends on it being correct.

It is a **single pass at every level**. `planned_sets` no longer carries
`parent_set_id` (§2.8 of the data model), so nothing in the plan tree
self-references and no level needs a second pass to remap ids.

Ids are minted by the caller, not by the database, so the clone generates a new
UUID per row as it walks and already holds the `old_id → new_id` map for the
level below before it writes anything (§3.9) — no `RETURNING`, no rejoin on a
natural key. That also makes the whole operation retry-safe: rerun it with the
same generated ids and every insert is a no-op.

### 0.3 Which operations must work offline

Only these, and they are all in §4:

| Operation | Offline |
|---|---|
| §4.2 start the workout | **yes** |
| §4.3–4.12 log, substitute, improvise, drop-set | **yes** |
| §4.15 edit a logged set | **yes** |
| §4.16 delete a logged set | **yes** — one request: delete, renumber, and drop an emptied exercise row in a single transaction |
| §4.13 finish the workout | **yes**, minus the extension check |
| §4.14 skip the workout | **yes** |
| everything in §1, §2, §3, §5 | no — plan-side and review work happens with a connection |

The client mints UUIDs for `workout_sessions`, `session_exercises`, and
`session_sets`, writes them to local storage, and a durable queue replays them
against the API when signal returns; every insert is
`ON CONFLICT (id) DO NOTHING`, so a retried flush is harmless (§2.11 of the data
model).

**A note on the SQL below.** Every table in this schema has a UUID primary key
minted in application code, never by the database (§2.11 of the data model). The
`INSERT`s below name `id` explicitly wherever it carries weight — the session
tables, where the client mints it offline, and the clone, where holding the id in
advance is what removes a pass. Elsewhere it is omitted for readability and
should be read as present.

The one operation that does not fully survive offline is §4.13. Marking a
session `COMPLETED` is a plain update and queues fine, but the program-extension
check it triggers is a server-side transaction over the plan tree. It therefore
runs **when the finish reaches the server**, not when the user taps the button.
The user-visible effect is nil: the extension only matters for what "what's
next?" returns, and that is a read they cannot do offline anyway.

---

## 1. Account

### 1.1 First sign-in

Clerk authenticates; middleware resolves the local anchor row on **every**
authenticated request, and provisions it on the first.

**Writes:** `users` (on first request only)

```sql
SELECT id, sub_status, deleted_at FROM users WHERE clerk_user_id = $clerk_id;

-- only when that returns no row
INSERT INTO users (id, clerk_user_id) VALUES ($new_uuid, $clerk_id)
ON CONFLICT (clerk_user_id) DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id
RETURNING id, sub_status, deleted_at;
```

The `$new_uuid` is generated in application code (UUIDv7) and thrown away on the
conflict path — ids are never database-generated in this schema (§2.11 of the
data model).

Read first, so a returning user's request writes nothing. The `DO UPDATE` on the
insert is for concurrent first requests: both miss, the loser conflicts, and
`DO UPDATE … RETURNING` returns the winner's row where `DO NOTHING` would return
none. A row with `deleted_at` set is refused with a 401.

### 1.2 Change the default weight unit

**Writes:** `users.default_weight_unit`

Invalidate the client's cached copy when this changes — the client resolves the
unit for offline writes (§4.3), so a stale cache would stamp the old unit onto
sets logged after the change. A session already in progress keeps the unit it
started with, which is the less surprising behaviour anyway.

Affects only sets written **after** the change. Existing `session_sets` keep the
`weight_unit` stamped at the time they were logged (§2.5), so history does not
reinterpret itself.

### 1.3 Set a per-exercise unit override

"The leg press at my gym is in KG."

**Writes:** `user_exercise_settings` (upsert on `(user_id, exercise_id)`)

```sql
INSERT INTO user_exercise_settings (user_id, exercise_id, default_weight_unit)
VALUES ($user, $exercise, 'KG')
ON CONFLICT (user_id, exercise_id)
DO UPDATE SET default_weight_unit = EXCLUDED.default_weight_unit,
              updated_at = now();
```

### 1.4 Delete the account

Clerk's `user.deleted` webhook fires.

**Writes:** `users.deleted_at`

```sql
UPDATE users SET deleted_at = now()
WHERE clerk_user_id = $clerk_id AND deleted_at IS NULL;
```

Idempotent: Clerk redelivers, and the `deleted_at IS NULL` guard means a
redelivery writes nothing, so the first timestamp — and the purge date it sets —
stands. A user who never made an authenticated request has no row; that is a
no-op, not an error. Nothing else changes. Six months later the purge job hard-deletes the row and
the `CASCADE` takes every program, plan, workout, session, and set with it.

---

## 2. Exercise catalog

### 2.1 Browse exercises

**Reads:** `exercises`, `exercise_metrics`

```sql
SELECT * FROM exercises
WHERE (owner_user_id IS NULL OR owner_user_id = $user)
  AND is_active
ORDER BY name;
```

Standard rows (`owner_user_id IS NULL`) and the user's own come back in one
query.

### 2.2 Create a custom exercise

**Writes:** `exercises`, `exercise_metrics`

Two statements, one transaction. The metrics are the part that matters — they
decide which input fields the logger renders later:

```sql
INSERT INTO exercises (id, owner_user_id, name,
                       primary_muscles, secondary_muscles, equipment)
VALUES ($ex_id, $user, 'Reverse Hyper',
        '{GLUTES}', '{HAMSTRINGS,LOWER_BACK}', 'MACHINE');

INSERT INTO exercise_metrics (exercise_id, metric, is_required)
VALUES ($ex_id, 'REPS',   TRUE),
       ($ex_id, 'WEIGHT', FALSE);
```

The `WITH … RETURNING id` dance an earlier draft used is unnecessary now that
ids are minted before the write.

`is_required = FALSE` on weight is what makes this work for a movement that is
usually bodyweight but sometimes loaded.

### 2.3 Record setup and cues for an exercise

Rack pin heights, form reminders. Persists across every program forever.

**Writes:** `user_exercise_settings.setup` / `.cues` (upsert)

This is the same row as §1.3 — settings and notes share a table.

### 2.4 Retire an exercise

**Writes:** `exercises.is_active = FALSE`

Never a `DELETE`. `planned_exercises` and `session_exercises` both reference it
`ON DELETE RESTRICT`, so a used exercise cannot be removed; retiring hides it
from pickers while leaving history intact.

---

## 3. Building a program

### 3.1 Create a program

The user names it, defines a cycle (say Push/Back/Legs), and answers one
question: **how many cycles, or open-ended?**

```sql
-- fixed: "12 weeks, then I'll reassess"
INSERT INTO workout_programs (id, user_id, name, status, target_cycles, start_date)
VALUES ($id, $user, 'Summer Strength', 'DRAFT', 12, CURRENT_DATE);

-- open-ended: "I'll run it until I feel like changing"
INSERT INTO workout_programs (id, user_id, name, status, target_cycles, start_date)
VALUES ($id, $user, 'Base Building', 'DRAFT', NULL, CURRENT_DATE);
```

Cycle 1 is then built by hand (§3.2–3.5) and §0.2's clone materializes the rest.
How many depends on `target_cycles`:

| | `target_cycles = 12` | `target_cycles IS NULL` |
|---|---|---|
| Clone runs | 11 times | **not at all** |
| `workout_plans` | 12 | 1 |
| `workouts` | 36 | 3 |

Do the whole thing in one transaction — a half-materialized program is a mess to
detect.

An open-ended program materializes **one** cycle, not two. The earlier design
kept a spare cycle ahead of the user; it did nothing, because extension fires on
program exhaustion and a spare makes the program non-exhausted (§2.10 of the
data model). Extension happens on the write path in §4.13, in the same
transaction as the session that triggers it, so the next read always finds a
cycle without a buffer.

"Cycle 4 of 12" reads `target_cycles`. An open-ended program has `NULL` there and
renders no denominator — no rule to remember, nothing to get wrong.

### 3.2 Add a workout to a cycle

**Writes:** `workouts`

```sql
INSERT INTO workouts (plan_id, name, position, notes)
VALUES ($cycle1, 'Back Day', 1, 'Rest 2-3 min on rows, 60s on accessories');
```

Rest guidance lives in `notes` by decision (§3.7 of the data model).

### 3.3 Add an exercise to a workout

**Writes:** `planned_exercises`

```sql
INSERT INTO planned_exercises (workout_id, exercise_id, position, target_sets)
VALUES ($back_day, $barbell_row, 0, 4);
```

`target_sets = 4` alone is a complete prescription — "do 4 sets, log what you
do." Everything below is optional.

### 3.4 Prescribe individual sets (optional)

**Writes:** `planned_sets`

```sql
INSERT INTO planned_sets
  (planned_exercise_id, set_number, target_reps_min, target_reps_max,
   target_weight, weight_unit)
VALUES ($pe, 1, 8, 12, 135, 'LB'),
       ($pe, 2, 8, 12, 135, 'LB'),
       ($pe, 3, 6, 10, 155, 'LB');
```

Three rows against `target_sets = 4` is legal and means "sets 1–3 prescribed,
set 4 freeform." A rep *range* is `min <> max`; an exact target is `min = max`.

### 3.5 Add a placeholder slot

**Writes:** `planned_exercises` with `exercise_id` NULL

```sql
INSERT INTO planned_exercises (workout_id, placeholder_label, position, target_sets)
VALUES ($back_day, 'do something that feels good', 4, 3);
```

The `CHECK (num_nonnulls(exercise_id, placeholder_label) = 1)` enforces that a
row is one or the other, never both and never neither.

### 3.6 Group exercises into a superset

**Writes:** `planned_exercises.group_key`

```sql
UPDATE planned_exercises SET group_key = 1
WHERE id IN ($bench, $row);
```

Order within the group is the existing `position`. "A1"/"A2" labels are derived
at render time, not stored.

### 3.7 Edit one cycle

**Writes:** whichever `planned_*` rows changed, in that cycle only

Nothing propagates. That is the whole point of materialized cycles — cycle 7 is
just rows.

### 3.8 Apply an edit to remaining cycles

An explicit user action, never an implicit consequence of §3.7 — and **offered
only at edit time**, in the same flow (and the same transaction) as the edit
itself. The guard below compares each cycle against the edited cycle *as it was
before the edit*; that pre-edit state exists only while the edit is being made.
There is no "propagate an edit I made last week" — by then the source of the
comparison is gone, and the correct tool is editing the target cycles directly.

**Writes:** deletes and re-clones `workouts` → `planned_sets` for cycles n+1…N

The implementation is delete-the-subtree-and-clone-over-it, with **one guard in
front of it**.

Trained cycles are excluded **by query, up front**: select the cycles ahead of
the edited one that have no `workout_sessions` row against any of their
workouts, and only those are candidates for replacement. The database backstops
this — `workout_sessions` references `workouts` `ON DELETE RESTRICT`, so a
trained cycle that slips through refuses to be deleted — but the `RESTRICT`
violation is a safety net, not the detection mechanism. Do not use a thrown FK
error as control flow.

What the database does **not** protect is a cycle the user deliberately made
different but has not trained yet — a deload at cycle 9, a planned intensity
step at cycle 12. Those are untouched by `RESTRICT` and a blunt re-clone
destroys them silently. That is not an edge case: per-cycle variation is the
entire reason cycles are materialized (§2.1 of the data model), so this
operation would quietly delete the feature it exists to serve.

**The guard:** before replacing cycle *k*, compare it to the cycle that the edit
came *from*, as it was before the edit. If they differ structurally — different
workout names or count, different exercises, different `target_sets`, different
prescribed sets — that cycle was authored, not inherited.

**The guard informs; the user decides.** Never silently skip a cycle the guard
flags, and never silently overwrite one either — inference about intent is a
suggestion, not an action. The confirmation step shows every future cycle as a
checkbox, pre-checked when it matched the pre-edit source, unchecked and
annotated when it looks authored:

> Apply to: ☑ 6 ☑ 7 ☑ 8 ☐ **9 — looks intentionally different (its own
> workouts/sets)** ☑ 10 ☑ 11 ☑ 12. Cycles 1–5 are already logged and cannot be
> changed.

The normalization that feeds the comparison must be pinned down in code, once:
workout names and positions, exercise ids (or placeholder labels) and
positions, `target_sets`, `group_key`, and all prescribed-set target columns.
**`notes` columns are excluded** — annotating a cycle is not authoring it.
Cheapest correct implementation: hash that normalized subtree of each cycle
before the edit, and pre-check the cycles whose hash matches the pre-edit
source. It needs no schema change and no stored version — the comparison
happens inside the same flow as the edit, which is why edit-time-only is a hard
constraint and not a UX preference.

### 3.9 Copy from an old program

**Writes:** a fresh `workout_programs` row and a full clone of the source's
cycle 1, then §0.2 for the rest

Nothing is shared with the source (§2.2 of the data model) — every row is new.

`UNIQUE (user_id, name)` makes the obvious default name collide with the
source. The application auto-suffixes — `"Summer Strength"` → `"Summer
Strength (2)"`, incrementing until free — rather than surfacing a constraint
error; the user can rename in the same flow.

The id remapping is straightforward because every level has a natural key. Each
child level joins old to new through the unique the schema already declares:

| Level | Natural key |
|---|---|
| `workout_plans` | `cycle_number` |
| `workouts` | `position` |
| `planned_exercises` | `position` |
| `planned_sets` | `set_number` |

With client-minted ids the map is built **before** the write rather than
recovered after it: read the source level, generate a new UUID per row, and you
already hold `old_id → new_id` for the next level down.

```sql
-- read the source level
SELECT id AS old_id, cycle_number, name, notes
FROM workout_plans WHERE program_id = $source_program;

-- app code: newId = uuidv7() per row, remember old_id -> new_id

-- write it
INSERT INTO workout_plans (id, program_id, cycle_number, name, notes)
VALUES ($new_id_1, $new_program, 1, …),
       ($new_id_2, $new_program, 2, …), …;
```

A recursive walk in application code is the readable way to write this, and now
also the natural one — the `RETURNING`-and-rejoin form only existed to recover
ids the database had chosen. Do it inside one transaction, and re-running it
with the same generated ids is a no-op rather than a duplicate program.

**Single pass, at every level.** An earlier draft needed a second pass here,
because `planned_sets` carried a self-referencing `parent_set_id` for prescribed
drop sets: insert all the sets, then go back and rewrite the children's parent
ids through the old→new map, or they would point at the *source* program's rows.
That column is gone (§2.8 of the data model), and with it the only
self-reference in the plan tree. Nothing in a clone now refers to a sibling, so
each level is one insert and one join.

### 3.10 Activate a program

**Writes:** `workout_programs.status`

```sql
UPDATE workout_programs SET status = 'ACTIVE' WHERE id = $program;
```

One statement. Any number of programs may be active at once (data-model.md §7
#30), so activating one **never touches another** — a running block started
alongside a lifting block leaves the lifting block running. Replacing a program
is two user actions: activate the new one, archive the old one (§3.11). The UI
may offer the second as a follow-up; it is never implied.

An abandoned program becomes `ARCHIVED`, not `COMPLETED`. Stopping a program is
abandonment, not completion, and marking it `COMPLETED` would make "programs I
finished" a lie. `COMPLETED` is written in exactly one place: §4.13, when the
final cycle is actually trained.

### 3.11 Archive a program

**Writes:** `workout_programs.status = 'ARCHIVED'`

A program with logged sessions cannot be deleted; `RESTRICT` up the chain sees
to that. Archiving is the intended end state.

### 3.12 Extend a program by one cycle

For a **fixed** program this is a user action: they finished cycle 12 and want
another. For an **open-ended** program it is automatic (§4.13) and the user is
never asked.

**Writes:** `workout_plans` ×1, plus a clone of its whole subtree, plus
`workout_programs.target_cycles` for a fixed program

Both paths run the same clone, sourcing the **highest-numbered existing cycle**
rather than cycle 1 — so any edits made along the way carry forward. Pick the
source row explicitly, then insert from it:

```sql
-- 1. the cycle to clone
SELECT id, cycle_number, name, notes
FROM workout_plans
WHERE program_id = $program
ORDER BY cycle_number DESC
LIMIT 1;                                  -- -> $src_id, $src_cycle, $name, $notes

-- 2. the new cycle
INSERT INTO workout_plans (id, program_id, cycle_number, name, notes)
VALUES ($new_id, $program, $src_cycle + 1, $name, $notes);
```

**Do not** try to collapse this into one statement with `MAX(cycle_number) + 1`
and a `GROUP BY`. An earlier draft did, grouping by `program_id, name, notes`,
which produces one row *per distinct name* — so a program containing a cycle
named "Deload" inserts two rows, one of which collides with an existing
`cycle_number`. It also silently fails to carry forward the last cycle's name,
which was the entire point. Read the source row, then write.

Then clone `workouts` → `planned_exercises` → `planned_sets` from `$src_id`
(§3.9) — one pass per level, no self-references to remap.

For a **fixed** program, the same transaction also increments the denominator and
reopens the program:

```sql
UPDATE workout_programs
SET target_cycles = target_cycles + 1,
    status        = 'ACTIVE'
WHERE id = $program;
```

Reactivating needs nothing else to be inactive — any number of programs may be
active at once (data-model.md §7 #30).

For an **open-ended** program `target_cycles` stays `NULL` and `status` is
already `ACTIVE`; only the clone runs.

### 3.13 Import a program

The universal bring-your-own-AI door (`workout-tracker-build-plan.md` step 4):
the user asks any chatbot — free tiers included — to draft a program in the
published JSON format, pastes it in, and the app creates it.

**Writes:** `workout_programs` → `planned_sets` — the same tree as §3.1, via
the same service-layer create path. Import is a *front end* to program
creation, not a second creation path.

The pipeline:

1. **Validate** the pasted document against the same Zod schemas in
   `packages/shared` that define the export format. Reject with line-level
   errors the user can paste back to their AI ("set 3 of Bench Day has
   `target_reps_max` < `target_reps_min`").
2. **Resolve exercise names.** The format carries exercise *names*, not ids —
   an external AI cannot know catalog UUIDs. Match case-insensitively against
   standard and the user's own exercises; anything unmatched is surfaced in the
   preview as "create as custom exercise (pick its metrics)" or "map to an
   existing one". Placeholder slots import as placeholders.
3. **Preview** the resolved program — cycles, workouts, exercises, set counts —
   before anything is written. Nothing touches the database until the user
   confirms.
4. **Create** through the §3.1 service function in one transaction: cycle
   structure as given (the format may describe cycles explicitly for
   pre-authored variation, or one cycle plus `target_cycles` for §0.2 to
   materialize). Name collisions auto-suffix as in §3.9.

Import never updates an existing program — it always creates. "Re-import to
edit" would reintroduce every propagation question §3.8 exists to answer;
editing happens in the app. Export is the same format in reverse — §5.4.

---

## 4. Training a session

### 4.1 "What's next?"

**Reads:** `workout_programs`, `workout_plans`, `workouts`, `workout_sessions`

The query in §5 of the data model: one row per active program, each program's
earliest unresolved workout, and the user picks which to train. Note its
predicate is `status IN ('COMPLETED','SKIPPED')` — a skipped workout is
*resolved*, and matching only `COMPLETED` would wedge the program behind it
forever.

### 4.2 Start the workout

**Writes:** `workout_sessions` ×1 — and nothing else (§0.1)

```sql
INSERT INTO workout_sessions (id, user_id, workout_id, status)
VALUES ($session_id, $user, $workout, 'IN_PROGRESS')
ON CONFLICT (id) DO NOTHING;
```

`$session_id` is a UUIDv7 the **client** minted, so this works with no signal and
a retried flush is a no-op (§0.3). The screen is then rendered from
`planned_exercises` + `planned_sets` joined to whatever has been logged so far —
all of it prefetched when the session started, while there was still a
connection.

### 4.3 Log the first set of an exercise

Two inserts: the `session_exercises` row appears lazily here, on first contact.

**Writes:** `session_exercises` ×1, `session_sets` ×1

```sql
INSERT INTO session_exercises (id, session_id, exercise_id, planned_exercise_id, position)
VALUES ($se_id, $session, $exercise, $planned_exercise, 0)
ON CONFLICT (id) DO NOTHING;
```

Then the set itself:

```sql
INSERT INTO session_sets
  (id, session_exercise_id, set_number, reps, weight, weight_unit, kind)
VALUES ($set_id, $se_id, 1, 8, 135, $resolved_unit, 'NORMAL')
ON CONFLICT (id) DO NOTHING;
```

**The client resolves the unit, and the server checks it.** The rule is
unchanged from §2.5 — per-exercise override first, user default second — but an
offline client cannot run a query to apply it, so it resolves from the settings
it cached at session start and sends `weight_unit` explicitly (§2.11 of the data
model). When a write arrives without one, the server falls back to the original
resolution:

```sql
INSERT INTO session_sets
  (id, session_exercise_id, set_number, reps, weight, weight_unit, kind)
SELECT $set_id, $se_id, 1, 8, 135,
       COALESCE($client_unit, ues.default_weight_unit, u.default_weight_unit),
       'NORMAL'
FROM users u
LEFT JOIN user_exercise_settings ues
       ON ues.user_id = u.id AND ues.exercise_id = $exercise
WHERE u.id = $user
ON CONFLICT (id) DO NOTHING;
```

`weight_kg` is generated and needs no mention. Both ids are client-minted, so
this whole pair replays safely.

### 4.4 Log the remaining sets

**Writes:** `session_sets` ×1 each, incrementing `set_number`

### 4.5 Substitute an exercise (rack taken)

Identical to §4.3 — the substitution *is* the ordinary insert, just with an
`exercise_id` that differs from the planned row's.

**Writes:** `session_exercises` with `substitution_note`

```sql
INSERT INTO session_exercises
  (id, session_id, exercise_id, planned_exercise_id, position, substitution_note)
VALUES ($se_id, $session, $dumbbell_bench, $planned_barbell_bench, 0, 'rack taken')
ON CONFLICT (id) DO NOTHING;
```

### 4.6 Fill a placeholder slot

Also identical to §4.3. `planned_exercise_id` points at the placeholder row;
`exercise_id` is whatever the user picked. No `substitution_note` — nothing was
substituted, the slot was resolved as designed.

### 4.7 Skip an exercise

**Writes:** nothing.

The absence of a `session_exercises` row *is* the skip. That stays true after an
undo: deleting an exercise's last logged set removes its row too (§4.16).

### 4.8 Add an unplanned exercise

**Writes:** `session_exercises` with `planned_exercise_id = NULL`

### 4.9 Stop early — 3 of 5 sets

**Writes:** nothing.

Log 3 sets and move on. `target_sets` still says 5; the gap is the record.

### 4.10 Do extra sets

**Writes:** `session_sets` with `set_number` 6, 7, …

Nothing constrains logged sets to `target_sets`. It is a target, not a limit.

### 4.11 Log a drop set

100×8 dropping to 80×6 then 60×4 — **one** working set with two children.

**Writes:** `session_sets` ×3

```sql
INSERT INTO session_sets (id, session_exercise_id, set_number, reps, weight, weight_unit, kind)
VALUES ($parent, $se, 3, 8, 100, 'LB', 'NORMAL');

INSERT INTO session_sets
  (id, session_exercise_id, set_number, reps, weight, weight_unit, kind, parent_set_id)
VALUES ($c1, $se, 4, 6, 80, 'LB', 'DROP', $parent),
       ($c2, $se, 5, 4, 60, 'LB', 'DROP', $parent);
```

No `RETURNING` is needed — `$parent` is a UUID the client already minted, which
is what lets a drop set be logged offline as a unit.

`set_number` stays one flat sequence, so ordering and the `UNIQUE` still work.
The set count is unaffected because children are excluded by
`parent_set_id IS NULL`. Myo-reps, rest-pause, and cluster sets are the same
shape and are logged as `DROP` today; distinguishing them is one
`ALTER TYPE set_type ADD VALUE` if it is ever wanted (§2.8 of the data model).

### 4.12 Log a bodyweight or timed exercise

**Writes:** `session_sets` with the other columns populated

```sql
-- Plank: 45 seconds
INSERT INTO session_sets (id, session_exercise_id, set_number, duration_seconds)
VALUES ($set_id, $se, 1, 45);

-- Mobility drill: just done
INSERT INTO session_sets (id, session_exercise_id, set_number, completed)
VALUES ($set_id, $se, 1, TRUE);
```

`weight`, `weight_unit`, and `reps` stay `NULL`; the
`num_nonnulls(...) > 0` check is satisfied by the one column that is set.

### 4.13 Finish the workout

**Writes:** `workout_sessions.status = 'COMPLETED'`, and possibly a whole new cycle

This is what advances §4.1. Without it, the same workout stays "next."

It is also the **only** place program extension is evaluated. After marking the
session complete, in the same transaction, check whether that was the last
workout of the last materialized cycle:

```sql
SELECT NOT EXISTS (
  SELECT 1
  FROM workout_plans p
  JOIN workouts      w ON w.plan_id = p.id
  WHERE p.program_id = $program
    AND NOT EXISTS (
      SELECT 1 FROM workout_sessions s
      WHERE s.workout_id = w.id
        AND s.status IN ('COMPLETED','SKIPPED')
    )
) AS program_exhausted;
```

If exhausted:

| `target_cycles` | Action |
|---|---|
| a number | `UPDATE workout_programs SET status = 'COMPLETED'`. The UI offers "run another cycle?" → §3.12, which increments `target_cycles`. |
| `NULL` | Run §3.12 silently. Status stays `ACTIVE`. The user is never asked. |

Note the predicate uses `IN ('COMPLETED','SKIPPED')`, matching §4.1 — a skipped
workout is resolved, so a program whose final workout was skipped still extends
correctly rather than hanging.

Only an `ACTIVE` program is checked. Finishing a session under an `ARCHIVED`
(or otherwise non-active) program still marks the session `COMPLETED`, but never
extends the program or sets it `COMPLETED`: archived means abandoned (§3.10).

Lock the program row (`SELECT … FROM workout_programs WHERE id = $program
FOR UPDATE`) before the exhaustion check. Two sessions finishing the program's
last two workouts concurrently would otherwise each see the other as
unresolved, and neither would extend.

Doing this on the write path rather than inside §4.1 is deliberate: "what's
next?" stays a pure read. The extension runs in the **same transaction** as the
status update that exhausted the program, so by the time any read happens there
is always a cycle to return. No spare cycle is materialized ahead of time and
none is needed (§2.10 of the data model).

**Offline note.** This is the one logged operation that is not fully local
(§0.3). The `status = 'COMPLETED'` update queues and replays like any other
write; the exhaustion check and extension run when it reaches the server. Nothing
the user can see offline depends on the difference.

### 4.14 Skip the whole workout

**Writes:** `workout_sessions` with `status = 'SKIPPED'`

A row is still required — it is the marker that says "resolved, nothing logged."
Writing no row at all would leave the workout as "next" forever.

### 4.15 Edit a logged set

**Writes:** `session_sets` ×1 (an `UPDATE` of `reps`, `weight`, and optionally
`weight_unit`)

```sql
UPDATE session_sets ss
SET reps        = $reps,
    weight      = $weight,
    weight_unit = COALESCE($client_unit, ss.weight_unit)
FROM session_exercises se
JOIN workout_sessions  s ON s.id = se.session_id
WHERE ss.id = $set_id
  AND se.id = ss.session_exercise_id
  AND s.user_id = $user;
```

(`s.user_id = $user` is the user-scoping helper, not an inline filter — see
`packages/db`.)

The request carries **absolute values**, not a delta, so replaying it writes the
same row the same way and is harmless — no `ON CONFLICT` is needed because
nothing is inserted. `set_number`, `kind`, `parent_set_id`, and `logged_at` are
untouched: an edit corrects what was lifted, it does not move the set. The unit
was stamped when the set was logged (§4.3); an edit that sends no unit keeps it,
and one that does send a unit is the device's resolved choice, as in §4.3.
`weight_kg` regenerates on its own.

An id that matches no row the user owns — missing, or someone else's, which look
the same — updates nothing and is answered `404`. That is a rejection (the
queue stops and shows it), not a no-op: an edit of a set that does not exist is
a bug on the client, and silently dropping it would hide one. The serial queue
(§0.3) makes this unreachable in normal use, since an edit is only sent after the
log that created its set has been acknowledged.

### 4.16 Delete a logged set

**Writes:** `session_sets` −1 (plus any `DROP` children, via
`ON DELETE CASCADE`), `session_sets.set_number` on the survivors, and
`session_exercises` −1 when that was its last set

Deleting the set leaves a gap in `set_number`, and §8.2 of the data model says
not to leave one. The delete, the renumber, and the emptied-parent cleanup are
**one transaction**; the client sends one request (`DELETE /sets/:id`), never a
delete followed by N renumbering updates.

```sql
BEGIN;

-- Lock the parent so two deliveries for one exercise serialize, and find it.
-- Zero rows here means the set is already gone: COMMIT and answer success.
SELECT se.id
FROM session_sets ss
JOIN session_exercises se ON se.id = ss.session_exercise_id
JOIN workout_sessions  s  ON s.id  = se.session_id
WHERE ss.id = $set_id AND s.user_id = $user
FOR UPDATE OF se;

DELETE FROM session_sets WHERE id = $set_id;

-- Renumber the survivors 1..n in their existing order. The UNIQUE on
-- (session_exercise_id, set_number) is DEFERRABLE INITIALLY DEFERRED (§3.6 of
-- the data model), so the intermediate states inside this one statement and
-- transaction are not checked; only the final state is.
UPDATE session_sets ss
SET set_number = r.n
FROM (
  SELECT id, row_number() OVER (ORDER BY set_number) AS n
  FROM session_sets
  WHERE session_exercise_id = $se
) r
WHERE ss.id = r.id
  AND ss.set_number <> r.n;

-- The last set is gone: remove the exercise row, so "skipped = no row" (§4.7)
-- is still true after an undo.
DELETE FROM session_exercises se
WHERE se.id = $se
  AND NOT EXISTS (
    SELECT 1 FROM session_sets WHERE session_exercise_id = se.id
  );

COMMIT;
```

`row_number()` over the survivors, rather than `set_number - 1` for those above
the deleted one, is what keeps numbering contiguous when the deleted set was a
drop-set parent whose children cascaded away with it (§4.11): the numbers are
one flat sequence, and every one after the removed block shifts down together.
Only rows whose number actually changes are written.

Removing the emptied `session_exercises` row restores the state before §4.3: no
exercise row, no sets. The next log for that exercise is an ordinary §4.3
first-contact pair. Without the cleanup the exercise would read as "performed
with zero sets", which no query expects.

**Idempotent by outcome.** A set that no longer exists — a replayed delete, or
an id that was never the user's — makes the transaction find nothing, change
nothing, and return success. Deletion is "make this id absent", and it already
is. There is no `ON CONFLICT` because there is nothing to insert. A replay can
never delete a *different* set after the renumber, because the delete is by
primary key, not by `set_number`.

---

## 5. Reviewing history

### 5.1 Exercise history

**Reads:** `session_sets` → `session_exercises` → `workout_sessions` → `exercises`

Always filter `parent_set_id IS NULL AND kind <> 'WARMUP'` and aggregate
`weight_kg`, never `weight` (§2.5, §2.8).

### 5.2 Cycle-over-cycle progression

The query the whole program structure exists to serve:

```sql
SELECT p.cycle_number,
       MAX(ss.weight_kg)                  AS top_set_kg,
       SUM(ss.reps * ss.weight_kg)        AS volume_kg
FROM session_sets ss
JOIN session_exercises se ON se.id = ss.session_exercise_id
JOIN workout_sessions  s  ON s.id  = se.session_id
JOIN workouts          w  ON w.id  = s.workout_id
JOIN workout_plans     p  ON p.id  = w.plan_id
WHERE p.program_id = $program
  AND se.exercise_id = $exercise
  AND ss.parent_set_id IS NULL
  AND ss.kind <> 'WARMUP'
GROUP BY p.cycle_number
ORDER BY p.cycle_number;
```

### 5.3 Plan versus actual

**Reads:** `planned_exercises` LEFT JOIN `session_exercises`

A `LEFT JOIN` from the plan side gives adherence in one pass: `NULL` on the
right is a skip, a differing `exercise_id` is a substitution, and comparing
`COUNT(session_sets)` to `target_sets` gives sets completed.

### 5.4 Export

**Reads:** plan tree, or everything.

**Program export** — the §3.13 import format in reverse: serialize one
program's plan tree (never its sessions) through the same Zod schemas in
`packages/shared`, with exercise names in place of ids so the document is
portable. Round-trips through §3.13 by construction, and doubles as "share a
program as text" and as the thing a user hands their AI as a starting point.

**Account export** — every row belonging to the user, plan side and log side,
as JSON. The data-portability answer for a paid product holding years of
training history, and the practical answer to a data-access request. A read of
everything the scoped-query helper can see; no new machinery.

Both are ordinary authenticated reads, **lapsed accounts included** — export is
never held hostage (§3.8 of the data model).

---

## 6. Write map

Which operations touch which tables. Useful for deciding what needs a
transaction and what a repository layer should own.

| Table | Written by |
|---|---|
| `users` | 1.1 sign-in, 1.2 unit preference, 1.4 delete, Stripe webhooks (§3.8 of the data model) |
| `exercises` | 2.2 create, 2.4 retire |
| `exercise_metrics` | 2.2 create |
| `user_exercise_settings` | 1.3 unit override, 2.3 setup/cues |
| `workout_programs` | 3.1 create, 3.10 activate (both programs), 3.11 archive, 3.12 extend, 3.13 import, 4.13 finish |
| `workout_plans` | 3.1 create, 3.8 apply-to-remaining, 3.9 copy, 3.12 extend, 3.13 import |
| `workouts` | 3.2, 3.8, 3.9, 3.12, 3.13 |
| `planned_exercises` | 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 3.12, 3.13 |
| `planned_sets` | 3.4, 3.7, 3.8, 3.9, 3.12, 3.13 |
| `workout_sessions` | 4.2 start, 4.13 finish, 4.14 skip |
| `session_exercises` | 4.3, 4.5, 4.6, 4.8, 4.16 delete (when its last set goes) |
| `session_sets` | 4.3, 4.4, 4.10, 4.11, 4.12, 4.15 edit, 4.16 delete and renumber |
| `processed_stripe_events` | Stripe webhook handler (§3.8 of the data model) |

Operations that must be one transaction: **3.1** (create program), **3.8**
(apply to remaining cycles), **3.9** (copy program), **3.10** (activate),
**3.12** (extend), **3.13** (import — validation and preview happen before the
transaction; the confirmed create is one), **4.3** (session exercise + first
set), **4.11** (drop set parent + children), **4.16** (delete a set: delete, renumber, and drop an emptied exercise row), and **4.13** (finish, which may
extend the program).

Several of those are genuinely *interactive* transactions — the clone reads a
level, then writes the next using what it read. That is the reason for the driver
note in §3 of the data model: Neon's HTTP driver cannot do this, and the
WebSocket `Pool` can. Choosing wrong at step 1 of the build plan surfaces here,
at step 4.

Operations that must be **idempotent** rather than transactional: everything in
§4 that the offline queue can replay (§0.3), which is handled by client-minted
ids plus `ON CONFLICT (id) DO NOTHING`, and the Stripe webhook handler, which is
handled by `processed_stripe_events`.
