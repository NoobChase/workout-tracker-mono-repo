# Workout Tracker — Data Model

Greenfield design. Replaces the legacy four-table schema described in
`legacy-db/` and `legacy-overview.md`. No migration path is assumed: none of the
legacy structure is carried across, and no legacy credential is.

A walkthrough of every user action and the rows it writes is in
[`operations.md`](operations.md); a fully-linked row-level example is in
[`worked-example.md`](worked-example.md).

Those documents are **retained deliberately as reference** — they record why
several decisions here went the way they did, and `legacy-overview.md` §0 lists
credentials that still need rotating independently of this rewrite.

---

## 1. Terminology

| Term | Meaning | Example |
|---|---|---|
| **Exercise** | Catalog entry. Defines what an exercise *is* and what it tracks. Standard (shared) or user-created. | "Barbell Bench Press" |
| **Workout** | One day's template: an ordered list of exercises with target sets. | "Back Day" |
| **Workout Plan** | One cycle: an ordered sequence of Workouts. | Push → Pull → Legs |
| **Workout Program** | A Workout Plan run for N cycles, with a start date and status. | "Summer Strength", 12 cycles |
| **Session** | An actual performance of one Workout, on one date. | Back Day, cycle 3, Oct 14 |

Hierarchy:

```
Workout Program  "Summer Strength"
├── Workout Plan  cycle 1
│   ├── Workout  "Push"   position 0
│   │   ├── Planned Exercise  Bench Press, 4 sets
│   │   │   ├── Planned Set 1   5 reps @ 135 lb
│   │   │   └── Planned Set 2   5 reps @ 155 lb
│   │   └── Planned Exercise  Overhead Press, 3 sets
│   ├── Workout  "Pull"   position 1
│   └── Workout  "Legs"   position 2
├── Workout Plan  cycle 2
└── ... cycle 12

Session  (Workout "Push", cycle 1, performed 2026-09-08)
├── Session Exercise  Bench Press
│   ├── Set 1   5 reps @ 135 lb
│   ├── Set 2   5 reps @ 155 lb
│   └── Set 3   4 reps @ 165 lb
└── Session Exercise  Overhead Press
```

---

## 2. Design decisions

### 2.1 Cycles are materialized, not overridden

You said cycles can vary. There are two ways to model that:

- **Base template + per-cycle overrides.** Fewer rows, but every read path needs
  a resolution layer (`COALESCE` the override onto the base), and it degrades
  badly the moment a cycle adds, removes, or reorders an exercise rather than
  just changing a number.
- **Materialize every cycle.** Creating a 12-cycle program generates 12 full
  copies up front. Cycle 7 is just rows; editing it touches nothing else. No
  resolution logic anywhere.

**Chosen: materialize.** A `workout_plans` row *is* one cycle
(`UNIQUE (program_id, cycle_number)`). "The same plan for 12 cycles" means 12
identical copies, which stay identical until you change one.

Cost is row count, and it is trivial here: a 12-cycle × 3-workout ×
6-exercise × 4-set program is ~2,600 rows total. The entire legacy database was
~1,700 rows.

The one UX consequence: editing cycle 1 does **not** propagate. If the user
wants "add this exercise to every remaining cycle," that is an explicit
application-layer action ("apply to cycles 2–12"), not a database behavior. That
is a feature — it is exactly what makes per-cycle variation safe.

**Confirmed requirement, not speculation:** pre-authoring future cycles to be
different — a deload written into cycle 9, an intensity wave across a block —
is a real use pattern this app must support. That is what rules out the lazier
alternative (materialize one cycle and clone-on-demand, as open-ended programs
already do), which would be simpler but makes future cycles unauthorable
because they do not exist yet. Materialization is the price of pre-authoring,
paid deliberately.

Two constraints on "apply to remaining cycles" follow from protecting authored
cycles, and both live in `operations.md` §3.8: the action is offered **only at
edit time** (its guard compares against pre-edit state, which no longer exists
later), and it **confirms per cycle with the user** rather than silently
skipping cycles it detects as authored.

### 2.2 Nothing is shared between programs

Every Workout Plan, Workout, Planned Exercise, and Planned Set belongs to
exactly one program, by FK, with `ON DELETE CASCADE` down the tree. "Copy from
an old program" is a deep-copy operation at the application layer that produces
new rows. Editing the copy can never reach back and alter the original or its
logged history.

The only shared entity is **Exercise** — the catalog. That is intentional: it is
what makes "how has my bench moved across every program I've run" answerable.

### 2.3 Per-set prescription is optional

`planned_exercises.target_sets` says *how many* sets. `planned_sets` rows are
optional detail saying *what* each set should be. Three valid states:

| State | Meaning |
|---|---|
| `target_sets = 3`, no `planned_sets` | "Do 3 sets." Log whatever you do. |
| `target_sets = 3`, 3 `planned_sets` | Fully prescribed: 5@135, 5@155, 5@165. |
| `target_sets = 3`, 1 `planned_set` | Partial. Set 1 prescribed, 2–3 freeform. |

Every target column on `planned_sets` is nullable, so a set can prescribe reps
without weight, weight without reps, or a rep *range* (`target_reps_min` /
`target_reps_max`, for "8–12 reps").

### 2.4 Exercises declare composable metrics, not a mode

An enum of modes (`REPS_WEIGHT`, `TIME_ONLY`, …) dead-ends the first time you
want reps + weight + RPE. Instead each exercise declares an ordered list of the
metrics it tracks:

| Exercise | Metrics |
|---|---|
| Barbell Bench Press | `REPS`, `WEIGHT` |
| Pull-up | `REPS`, `WEIGHT` (optional — added plates) |
| Plank | `DURATION` |
| Farmer's Carry | `DURATION`, `WEIGHT` |
| Treadmill | `DURATION`, `DISTANCE` |
| Hip Mobility Drill | `COMPLETED` (checkbox) |

`exercise_metrics.is_required` distinguishes "a pull-up set must have reps" from
"weight is offered but usually blank."

The table deliberately carries **no display order**. Field order comes from a
fixed global precedence over the metric kinds — weight, reps, duration,
distance, RPE — rendering whichever are present. A logger whose field order
varied per exercise would be less consistent, not more, and a per-exercise
ordering column is config with no screen a user would ever want to visit. The
same precedence rule derives the headline metric for compact summaries, so a
plank reads "45s" and a bench reads "135 × 8" without storing which leads.

Underneath, a logged set uses **fixed nullable typed columns**, not a key/value
EAV table. The metric list drives which fields the UI renders and validates; the
typed columns keep `MAX(weight)`, `SUM(reps * weight)`, and date-range
aggregation trivial. A `CHECK` ensures a set row records at least one value.

### 2.5 Units are stamped per row, never entered per row

Legacy stored no unit at all. Here, `weight_unit` sits beside `weight` on every
planned and logged set — but **the user never picks it.** The application stamps
it from `users.default_weight_unit` at write time; it is not a field in the
set-logging UI.

The reason it lives on the row is not flexibility, it is **immutability of
history**. If the unit lived only on `users`, flipping that preference LB → KG
would silently reinterpret every past row — `135` becomes 135 kg and the whole
training history is corrupted by a settings toggle. Storing the unit alongside
the value freezes the past, the same reasoning as storing the weight as entered.

But a per-row unit without normalization is *worse* than no per-row unit: one
stray KG row makes `MAX(weight)` silently wrong. So every unit-bearing value
also gets a **generated canonical column**:

```sql
weight_kg  NUMERIC(10,4) GENERATED ALWAYS AS (
             weight * CASE weight_unit WHEN 'KG' THEN 1
                                       WHEN 'LB' THEN 0.45359237 END
           ) STORED
```

Every unit is named explicitly and there is **no `ELSE` branch**. A `CASE` with
no match yields `NULL`, so if a third unit is ever added to the enum without
updating this expression, aggregates go visibly `NULL` instead of silently
converting the new unit as pounds. Silent-wrong is the failure mode this whole
section exists to prevent; the no-`ELSE` form makes the generated columns fail
loudly instead of quietly. (`distance_m` follows the same rule — all four
`distance_unit` values named, no catch-all.)

That splits the two jobs cleanly:

| Column | Job |
|---|---|
| `weight` + `weight_unit` | Display truth. `135` typed in LB renders as `135 lb`, forever, exactly as entered. |
| `weight_kg` | Comparison truth. Every `MAX`, `SUM`, PR check, and progression chart reads this. |

You never convert *back* — the generated column is comparison-only, so
round-trip precision never arises. `0.45359237` is exact by definition (the 1959
international pound), so nothing drifts. `distance` gets the same treatment via
`distance_m`. Reps, duration, and RPE have no unit ambiguity; duration is always
stored as seconds and formatted for display.

Generated `STORED` columns are a plain PostgreSQL feature, so nothing here is
exotic.

**Overrides — decided, with a correction.** The real case is mixed-unit
equipment: most of the gym in LB, but a plate-loaded machine marked in KG.

An earlier draft proposed `exercises.default_weight_unit`. That is the wrong
table. `exercises` holds **standard** rows shared by every user
(`owner_user_id IS NULL`), so a unit set there would apply to everyone — and
"the leg press at *my* gym is in KG" is a fact about a user, not about the
exercise. The right home is the already-existing per-user, per-exercise table,
`user_exercise_settings` (§3.4), which is keyed `UNIQUE (user_id, exercise_id)`
and works for standard and user-created exercises alike.

Resolution order at write time:

```sql
COALESCE(ues.default_weight_unit,   -- this user, this exercise
         u.default_weight_unit)     -- this user's global default
```

**Where that resolution runs moves in §2.11.** Because sets are logged offline,
the *client* applies this rule against settings it cached at session start and
sends `weight_unit` explicitly; the server keeps the same `COALESCE` as its
fallback for writes that arrive without one. The rule is identical either way —
only its location changes.

The per-set override in the UI stays as the last-resort escape hatch. And none
of this touches history: once a set is written, its stamped `weight_unit` is
frozen regardless of any preference changed afterwards.

### 2.6 Identity lives in Clerk; the `users` row is an anchor

Authentication, credentials, email, MFA, and session management are Clerk's.
This schema keeps a local `users` row anyway, for two reasons:

1. **It is the FK anchor.** Every domain table references `users.id`. Scattering
   Clerk's string ids (`user_2abc…`) across a dozen foreign keys would repeat the
   legacy mistake of string-keyed relationships — wider indexes, slower joins,
   and a vendor identifier welded into every table.
2. **It holds app-owned state** that Clerk has no concept of, like
   `default_weight_unit`.

So the local table shrinks to a mapping plus preferences, and
`clerk_user_id TEXT UNIQUE` is the single point of coupling. Migrating off Clerk
later touches one column, not the whole schema.

What Clerk takes over entirely: `password_hash` (gone — the legacy plaintext
problem disappears rather than being fixed), `username` / `email`, and the
`Alyssa` / `alyssa` case-collision that `CITEXT` was there to solve.

**Do not denormalize Clerk profile fields** into this table by default. A local
copy of `email` or `username` goes stale the moment the user edits it in Clerk,
and you are then maintaining a sync. Read profile data from Clerk. If a screen
later needs many users' display names at once, add an explicitly-labelled cache
refreshed by a `user.updated` webhook — deliberately, not by drift.

---

### 2.7 A session never mutates the plan

This is the rule that makes everything in §8 work. Substituting an exercise,
cutting sets short, adding sets, going off-script entirely — all of it is
written to the **session** tables. The `planned_*` rows for that cycle are never
touched.

Two consequences worth being deliberate about:

- Plan-versus-actual stays answerable forever. "I was prescribed 5 sets and did
  3" is a real, queryable fact rather than a plan that quietly rewrote itself.
- If the user wants a deviation to *stick* — "I'm switching to dumbbell press
  for the rest of the program" — that is an explicit, separate action against
  the plan ("update cycles 4–12"), never an implicit side effect of logging.

### 2.8 Set technique: `group_key` across exercises, `parent_set_id` within one

Supersets and drop sets look similar in a UI and are structurally opposite, so
they get two different mechanisms.

**Across exercises** (superset, circuit, giant set) — a relationship *between*
exercises. Handled by `group_key` on `planned_exercises` and
`session_exercises`: `NULL` means standalone, equal values mean the same group,
and ordering within the group is the existing `position`. Display labels
("A1", "A2") are derived, not stored.

**Within one exercise** (drop set, myo-reps, rest-pause, cluster) — all of these
are one working set with extensions hanging off it: 100×8 → drop to 80×6 → drop
to 60×4 is *one* set, not three. Handled by a self-referencing `parent_set_id`
on `session_sets`. The parent is the working set; children are its extensions.
That single mechanism covers the whole family — myo-reps, rest-pause, and
cluster sets are identical in shape to a drop set, differing only in label.

**`set_type` is three values, not nine.**

```sql
CREATE TYPE set_type AS ENUM ('NORMAL','WARMUP','DROP');
```

An earlier draft had nine, adding `MYO`, `REST_PAUSE`, `CLUSTER`, `AMRAP`,
`BACKOFF`, and `FAILURE`. They are cut on exactly the reasoning §3.7 applies to
rest periods, which that draft did not apply here: `ALTER TYPE … ADD VALUE` is
one line, with no backfill, no data migration, and no change to any existing
query. The structure — which is the genuinely expensive part — is already
carried by `parent_set_id`. Only the labels were speculative, and labels are
cheap on the day someone wants one.

`kind` subsumes the earlier `is_warmup` boolean.

**Set technique is logged, never prescribed.** `planned_sets` carries no `kind`
and no `parent_set_id`. Prescribing a drop-set tree in advance is a feature
nobody has asked for, and it was the sole reason the clone primitive
(`operations.md` §0.2) needed a second pass to remap self-references. Without
it, cloning is a single-pass `INSERT … SELECT` at every level. Both columns are
additive if plan-side techniques are ever wanted.

The rule that falls out, and the one every count and chart should use:

```sql
-- a set that "counts": a real working set, not a warmup, not an extension
WHERE parent_set_id IS NULL AND kind <> 'WARMUP'
```

So "did I hit 5 sets?" is a `COUNT(*)` with that predicate, and a drop set still
counts as the one set it is. Be honest that this predicate is the running cost
of the mechanism: it has to appear in every aggregate, forever, and omitting it
silently inflates counts and corrupts charts. Put it in one shared query helper
rather than retyping it at each call site.

Nesting is one level deep by intent — a child may not itself be a parent. That
is not expressible as a `CHECK`; enforce it in the application (or with a
trigger, if you want the database to guarantee it).

### 2.9 Placeholder slots

`planned_exercises.exercise_id` is **nullable**, paired with
`placeholder_label TEXT` and a `CHECK` that exactly one of the two is set. A
planned row is therefore either a concrete exercise or a slot the user fills on
the day.

The label is **deliberately free text, with no structure behind it**. It can be
a muscle group ("Quads"), a category ("Hamstring accessory"), or an instruction
that resolves to nothing in particular — "do something that feels good", "weak
point work", "conditioning finisher". Anything the user would write on a
notecard is valid.

The alternative, inventing catalog entries like "Quads (choose one)", was
rejected: it pollutes the shared exercise list and breaks
`exercise_metrics`, since a placeholder has no meaningful metrics of its own
until it is resolved.

Filling a placeholder needs no new machinery — it is the substitution mechanism
from §8.1. The session row records the concrete exercise; its
`planned_exercise_id` points at the slot. On the logging side
`session_exercises.exercise_id` stays `NOT NULL`, because whatever you actually
did was something specific.

**Decided: placeholders do not prescribe a muscle group.** An earlier draft
argued that slots should be typed so the app could filter the catalog to "quad
exercises". Rejected — it would force every placeholder to be classifiable,
which "do something that feels good" is not, and it would make
`exercises.muscle_group` load-bearing for a feature nobody asked for. The
resolution UI shows the label and the full exercise list; the user picks.

### 2.10 Fixed-length and open-ended programs

Two ways a user thinks about a block:

- *"12 weeks of this, then I'll reassess."* — a **fixed** program.
- *"I'm just going to run this until I feel like changing."* — **open-ended**.

Both must work without nagging. A fixed program should offer "run another
cycle?" when it ends; an open-ended one must never ask, because asking every
single cycle is the entire thing the user is trying to avoid.

`workout_programs.target_cycles SMALLINT` is the whole mechanism. A number means
fixed; `NULL` means open-ended.

| | `target_cycles = 12` | `target_cycles IS NULL` |
|---|---|---|
| Cycles materialized up front | All twelve | One |
| On finishing the last cycle | Program → `COMPLETED`, offer to extend | Silently clone one more cycle |
| Ends when | The last cycle is trained | The user archives it |
| Progress display | "Cycle 4 of 12" | "Cycle 4" — no denominator |

It lives on the **program**, not on `workout_plans` — a `workout_plans` row is
one cycle, so a per-cycle value would be meaningless.

**Why a column and not a boolean.** An earlier draft used
`auto_extend BOOLEAN` and refused to store the cycle count, deriving "of 12"
from `COUNT(*)` over the materialized `workout_plans`. That forced two
workarounds, both of which are gone now:

- The count was only meaningful for fixed programs. For an open-ended one it was
  a materialization artifact, so the draft added a rule that the denominator
  must never be displayed — a correctness rule enforced by convention, in every
  component that renders progress.
- It kept a **spare cycle** materialized ahead of the user so the "what's next?"
  read always found a row. That buffer did not work. Extension fires when the
  program is *exhausted* — no unresolved workout anywhere in it — which is false
  while a spare exists. So the spare is consumed first, and after the very first
  extension there is never a spare again. It was a one-time artifact that
  decayed on first use, in exchange for making `COUNT(*)` lie.

With `target_cycles` the denominator is read from a column, `NULL` renders as no
denominator, and extension needs no buffer: it fires on program exhaustion
inside the same transaction as the session that caused it (§4.13 of
`operations.md`). That is a write path, so "what's next?" stays a pure read and
still always finds a row.

**Extension clones the cycle that just finished, not cycle 1.** If the user
tweaked cycle 7, cycle 8 inherits the tweak — "keep doing what I'm doing now" is
the only sensible reading of an open-ended block. Extending a *fixed* program
increments `target_cycles` alongside the new `workout_plans` row, so the
denominator stays true.

### 2.11 Offline logging, and why the ids are UUIDs

Set logging happens in gym basements with no signal, mid-set, one-handed. The
app is therefore **offline-capable for logging**: writes land in local storage
immediately and a durable queue flushes them when connectivity returns
(`workout-tracker-build-plan.md` step 3).

That is deliberately *not* full local-first. The offline surface is exactly four
operations — start a session, log a set, edit or delete a set, finish the
session — and every one of them writes to `workout_sessions`,
`session_exercises`, and `session_sets` and nowhere else. Everything on the plan
side (building programs, cloning cycles, activating, editing) happens at home
with a connection and stays an ordinary server round trip, where it keeps its
transactions and its database constraints.

Three consequences for the schema:

**Primary keys are UUIDv7, generated in the application layer.** A client with
no signal has to mint a session id, then `session_exercises` ids referencing it,
then `session_sets` ids referencing those — a whole subtree, before the server
has seen any of it. `BIGSERIAL` cannot do that. v7 rather than v4 because it is
time-ordered, so index locality and insert behaviour stay close to a sequence.
Generate ids in application code rather than as a database default, so the same
path works on the client and on the server.

Every table uses UUID, not only the three that need it. Mixed key types mean
every repository function and every join has to remember which kind it is
holding — a permanent tax to save eight bytes a row.

**The id doubles as the idempotency key.** A flush retried after a flaky
connection replays the same insert with the same primary key:

```sql
INSERT INTO session_sets (id, …) VALUES ($1, …)
ON CONFLICT (id) DO NOTHING;
```

No separate `client_request_id` column, no dedupe table.

**What is deliberately absent:** `updated_at` on every table, tombstones for
deleted rows, a change feed, and any conflict-resolution policy. Those are the
cost of true local-first and they buy one thing this app does not need —
browsing full training history offline. Conflicts here are not merely rare, they
are close to unconstructible: one user, one in-progress session at a time,
append-mostly rows with client-minted keys. Last write wins, and there is
nothing to lose by it.

If full local-first is ever wanted, it is additive from here: the client-minted
ids are already in place, and `updated_at` plus tombstones is a migration rather
than a rewrite.

**One behavioural change this forces.** §2.5 resolves `weight_unit` from
`user_exercise_settings` then `users` — a server-side `COALESCE` at insert time
(`operations.md` §4.3). An offline client cannot run that query, so **the client
resolves the unit** from settings it cached when the session started and sends
it explicitly. The server keeps the same `COALESCE` as the fallback for writes
that arrive without one. History is unaffected either way: the stamped unit is
frozen once written.

## 3. Schema

**PostgreSQL.** Settled — the schema leans on partial unique indexes
(`one_active_program_per_user`, the two exercise-name indexes), deferrable
constraints for reordering, `num_nonnulls`, and generated columns. MySQL 8 has
only the last of those, so the others would become application-enforced
conventions instead of guarantees. Postgres keeps them in the database.

**Hosted on Neon** (`workout-tracker-build-plan.md` step 1), which is stock
PostgreSQL — every feature above is available. Connect with the WebSocket driver
(`@neondatabase/serverless` `Pool`), not the HTTP one: several operations in
`operations.md` are genuinely interactive multi-statement transactions, which
the HTTP driver cannot do.

**The schema itself lives in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts).**
The DDL that used to be here (and in `schema.dbml`) was deleted when that file
landed, leaving this section to hold the *reasoning* — the part that cannot be
generated and does not go stale. Two exceptions remain below, each marked: the
session tables (§3.6, step 3) and `processed_stripe_events` (§3.8, step 5), which
stay as spec until the step that adds them to the schema file deletes them.

### 3.1 Enums

Defined in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) (the enums).

`set_type` is three values by decision (§2.8), not an oversight. The billing
enum is used in §3.8. An earlier draft also had a `sub_tier ENUM ('FREE','PRO')`
— cut, because with a single paid tier it is fully derivable from `sub_status`
and nothing defined what it gated. If a second paid tier ever exists, adding a
tier column is additive (§3.7's line applies: defer the additive).

### 3.2 Users (Clerk-backed)

Defined in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) (`users`).

No `password_hash`, no `email`, no `username` — see §2.6. The `UNIQUE` on
`clerk_user_id` doubles as the lookup index for the request path below.
`deleted_at` drives the soft-delete flow in §4. The three subscription columns
(`sub_status`, `sub_current_period_end`, `stripe_customer_id`) are §3.8; they
are here from day one, populated by hand until Stripe lands, so that
entitlement checks are written into every endpoint as it is built rather than
retrofitted across all of them later.

**`id` is a UUID, not a `BIGSERIAL`** — see §2.11. Every table in this schema
follows suit. Ids are generated in application code (UUIDv7), never by a column
default, so the client can mint a whole session subtree offline.

**Provisioning.** Create the local row **just-in-time on the first authenticated
request**, in middleware, rather than relying on Clerk's `user.created` webhook
as the critical path. Every request reads first; the upsert runs only on a miss:

```sql
SELECT id, sub_status, deleted_at FROM users WHERE clerk_user_id = $1;

-- only when that returns no row
INSERT INTO users (id, clerk_user_id) VALUES ($new_uuid, $clerk_id)
ON CONFLICT (clerk_user_id) DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id
RETURNING id, sub_status, deleted_at;
```

A webhook can be delayed, retried, or dropped, which produces a race where the
user's first request arrives before their row exists. JIT provisioning has no
such window. The read comes first because running the upsert on every request
would make each one a real `UPDATE` — `DO UPDATE` writes a new row version even
when nothing changes — on the hottest small table, for nothing. The `DO UPDATE`
stays on the insert for the race: two concurrent first requests both miss, the
loser's insert conflicts, and `DO UPDATE … RETURNING` hands it the winner's row
where `DO NOTHING` would return none. The read also returns `sub_status`, so
entitlement costs no second query. Use webhooks for deletion (below), not for
creation.

**Authorization is still yours.** Clerk tells you *which* user is making the
request. It does not tell you that this user owns program 47. Every query still
needs an explicit `WHERE user_id = $current`, enforced at the data-access layer.
This is precisely what the legacy backend got catastrophically wrong — it had no
authorization at all, and `GET /api/users` returned every account's plaintext
password to any caller. Clerk removes the authentication half of that problem
and none of the authorization half.

**Seed and test data** need a `clerk_user_id`; use a reserved prefix such as
`seed_…` so fixtures are trivially distinguishable from real Clerk ids.

### 3.3 Exercise catalog

Defined in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) (`exercises`, `exercise_metrics`).

`owner_user_id IS NULL` = ships with the app, visible to everyone. Non-null =
the user's own. A user's list is `WHERE owner_user_id IS NULL OR owner_user_id = $1`.

Exercises are never hard-deleted once referenced (`ON DELETE RESTRICT` from
planned and session rows); retire them with `is_active = FALSE`.

Note that retiring does **not** free the name — the unique indexes ignore
`is_active`. That is deliberate: two rows called "Barbell Row" meaning different
things would make every history query ambiguous. Rename the retired one if the
name is genuinely needed again.

Standard exercises ship with **fixed, hard-coded UUIDs** in the seed data, so
the same catalog entry has the same id in every environment and a seeded plan
fixture is portable.

### 3.4 Per-user exercise settings

Defined in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) (`user_exercise_settings`).

This is the legacy `exerciseList` done properly: `TEXT` instead of `varchar(45)`
(which truncated real notes mid-sentence), and separated from the catalog so a
user can annotate a **standard** exercise without forking their own copy of it.

### 3.5 Program → Plan → Workout → Planned Exercise → Planned Set

Defined in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) (`workout_programs`, `workout_plans`, `workouts`, `planned_exercises`, `planned_sets`).

The two unit `CHECK`s are not optional politeness. Without them,
`target_weight = 100` with a `NULL` `weight_unit` is legal, the generated
column's `CASE` matches nothing, and `target_weight_kg` is `NULL` — a weight
that silently vanishes from every `MAX`, `SUM`, and chart. That is the
silent-wrong-aggregate failure §2.5 exists to prevent, and `session_sets` has
carried the same pair of checks all along. Note the `CASE` names every unit and
has **no `ELSE`** — see §2.5 for why.

`UNIQUE (user_id, name)` on `workout_programs` means "copy from an old program"
collides with the source's name. Decided: the application auto-suffixes the
copy (`"Summer Strength (2)"`) rather than failing — see `operations.md` §3.9.

No `kind`, no `parent_set_id` — set technique is logged, not prescribed (§2.8).

`DEFERRABLE INITIALLY DEFERRED` on the position uniques matters: reordering
exercises within a transaction would otherwise trip the constraint mid-update.

### 3.6 Session → Session Exercise → Session Set

**Not yet in `schema.ts`** — the session tables land in step 3. Until then this
block is the spec; delete it in the change that adds them to the schema file.

```sql
CREATE TABLE workout_sessions (
  id           UUID           PRIMARY KEY,
  user_id      UUID           NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  workout_id   UUID           REFERENCES workouts(id) ON DELETE RESTRICT,  -- NULL = ad-hoc
  performed_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  status       session_status NOT NULL DEFAULT 'IN_PROGRESS',
  notes        TEXT,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX workout_sessions_user_date_idx ON workout_sessions (user_id, performed_at DESC);
CREATE INDEX workout_sessions_workout_idx   ON workout_sessions (workout_id);

CREATE TABLE session_exercises (
  id                  UUID     PRIMARY KEY,
  session_id          UUID     NOT NULL REFERENCES workout_sessions(id)  ON DELETE CASCADE,
  exercise_id         UUID     NOT NULL REFERENCES exercises(id)         ON DELETE RESTRICT,
  planned_exercise_id UUID     REFERENCES planned_exercises(id) ON DELETE SET NULL,
  position            SMALLINT NOT NULL CHECK (position >= 0),
  group_key           SMALLINT,
  substitution_note   TEXT,    -- "squat rack taken"
  notes               TEXT,
  UNIQUE (session_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX session_exercises_exercise_idx ON session_exercises (exercise_id);

CREATE TABLE session_sets (
  id                  UUID     PRIMARY KEY,
  session_exercise_id UUID     NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  set_number          SMALLINT NOT NULL CHECK (set_number >= 1),
  reps                SMALLINT     CHECK (reps >= 0),
  weight              NUMERIC(7,2) CHECK (weight >= 0),
  weight_unit         weight_unit,
  weight_kg           NUMERIC(10,4) GENERATED ALWAYS AS (
                        weight * CASE weight_unit
                          WHEN 'KG' THEN 1
                          WHEN 'LB' THEN 0.45359237 END
                      ) STORED,
  duration_seconds    INT          CHECK (duration_seconds >= 0),
  distance            NUMERIC(9,3) CHECK (distance >= 0),
  distance_unit       distance_unit,
  distance_m          NUMERIC(12,4) GENERATED ALWAYS AS (
                        distance * CASE distance_unit
                          WHEN 'M'  THEN 1
                          WHEN 'KM' THEN 1000
                          WHEN 'MI' THEN 1609.344
                          WHEN 'FT' THEN 0.3048 END
                      ) STORED,
  completed           BOOLEAN,
  rpe                 NUMERIC(3,1) CHECK (rpe BETWEEN 0 AND 10),
  kind                set_type     NOT NULL DEFAULT 'NORMAL',
  parent_set_id       UUID         REFERENCES session_sets(id) ON DELETE CASCADE,
  notes               TEXT,
  logged_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (session_exercise_id, set_number) DEFERRABLE INITIALLY DEFERRED,
  CHECK (weight   IS NULL OR weight_unit   IS NOT NULL),
  CHECK (distance IS NULL OR distance_unit IS NOT NULL),
  CHECK (num_nonnulls(reps, weight, duration_seconds, distance, completed) > 0)
);
```

`planned_exercise_id` is nullable: a `NULL` means the user added the exercise
on the fly, off-script. That is the link legacy never had — it lets you ask
"did I hit the prescription?" instead of matching name strings.

A set that was not performed is simply **no row**. This removes both the legacy
cap of six sets and the `''`-means-absent convention.

`kind` and `parent_set_id` carry set technique — see §2.8. A set counts toward
`target_sets` when `parent_set_id IS NULL AND kind <> 'WARMUP'`.

`UNIQUE (session_exercise_id, set_number)` is `DEFERRABLE` because deleting a
logged set mid-session means renumbering the survivors, which trips a
non-deferrable unique halfway through the update (§8.2).

**Two constraints that are deliberately absent.**

*Nothing enforces that `workout_sessions.workout_id` belongs to the same user as
`workout_sessions.user_id`*, and likewise for `session_exercises.planned_exercise_id`
and for a `user_exercise_settings` row pointing at another user's private
exercise. Expressing these in the database means composite foreign keys carrying
`user_id` down every level, which widens five tables to protect against a bug
rather than against user input. It stays an application invariant — but it is
the one invariant whose failure is a cross-tenant data leak rather than a glitch,
so it belongs in the scoped-query helper and in a test, not in a code review
checklist. That is `packages/db/src/scope.ts` (`assertOwned`,
`assertExercisesUsable`), tested against a real database in
`packages/db/test/scope.test.ts`.

*Nothing prevents two `IN_PROGRESS` sessions.* A partial unique index would
express "one workout at a time" neatly, and it is left out on purpose: with the
offline write queue (§2.11), a client holding an abandoned in-progress session
would have its next flush rejected by a constraint the queue has no way to
resolve. Surface unfinished sessions in the UI instead — "you have a workout in
progress, resume or discard?" — which is better product behaviour anyway.

### 3.7 Where free-text notes live

Every level of both trees already has a `notes` column, so plan-time guidance
has somewhere to go without a dedicated column per concept:

| Column | Scope | Typical use |
|---|---|---|
| `workout_programs.notes` | The whole program | Intent, source, "12-week block from X" |
| `workout_plans.notes` | One cycle | "Deload — everything at 60%" |
| `workouts.notes` | One day | "Rest 2–3 min on compounds, 60s on accessories" |
| `planned_exercises.notes` | One exercise in the plan | "Rest 90s. Last set to failure." |
| `planned_sets.notes` | One prescribed set | "Top set — go heavy" |
| `workout_sessions.notes` | One logged session | "Slept badly, felt flat" |
| `session_exercises.notes` | One exercise as performed | "Shoulder twinged on set 3" |
| `session_sets.notes` | One logged set | "Two reps left in the tank" |
| `user_exercise_settings.setup` / `.cues` | Persistent, per user per exercise | "J-cups at 14" / "pull the bar apart" |

The last row is the one that is easy to miss: `user_exercise_settings` persists
**across every program forever**, so rack heights and form cues are written once
rather than re-typed into each cycle's `planned_exercises.notes`. Use plan-level
notes for what is specific to *this* block, and `user_exercise_settings` for what
is true about the exercise itself.

**Decided: rest periods are notes, not columns.** No `target_rest_seconds`
anywhere. Rest guidance goes in `workouts.notes` or
`planned_exercises.notes` as prose.

The cost is real and worth stating: free-text rest cannot drive a rest timer,
cannot be queried, and cannot be compared across cycles. The reason to accept it
is that a structured rest column is **trivially additive later** — a nullable
`SMALLINT` with no backfill, no data migration, and no change to any existing
query.

The line this draws is between columns that are *additive* and mechanisms that
are *structural*. `group_key` and `parent_set_id` (§2.8) are structural: they
change how a set relates to other rows, and every aggregate has to know about
them, so retrofitting means revisiting every query. A rest column, a
`target_rest_seconds`, an extra `set_type` value — those are additive, and
deferring them costs one migration on the day they are wanted. Defer the
additive; build the structural now. Note that this reasoning is what removed the
six speculative `set_type` values in §2.8, which an earlier draft had defended as
though they were structural.

### 3.8 Billing state

Stripe owns subscriptions; `users` caches the parts an authorization check needs
so that no request path calls the Stripe API (`workout-tracker-build-plan.md`
step 5).

Defined in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) (`users`).

**Entitlement is `sub_status IN ('TRIALING','ACTIVE')`** — call it `isPro` —
read from the local row on every request that needs it. `PAST_DUE` deliberately
does **not** entitle — but it is a distinct value from `CANCELED` so the UI can
say "your card failed" rather than "you cancelled". `sub_current_period_end`
exists so the UI can render "renews on…" and "access until…" without a Stripe
round trip. There is no `sub_tier` column: with one paid tier it is derivable
from `sub_status` (§3.1), and a tier column is additive if a second paid tier
ever exists.

**What Free and Pro actually get.** This was previously unspecified, which made
the billing columns dead weight. Decided:

| | Free (`sub_status` anything else) | Pro (`TRIALING` / `ACTIVE`) |
|---|---|---|
| Logging, offline queue, history browsing | ✔ | ✔ |
| Program building, editing, cloning, placeholders | ✔ | ✔ |
| Custom exercises, per-exercise settings | ✔ | ✔ |
| Program import/export (the published JSON format) | ✔ | ✔ |
| Progression analytics (cycle-over-cycle, plan-vs-actual, PR history) | ✖ | ✔ |
| MCP connector (bring-your-own-AI) | ✖ | ✔ |

The line is drawn so the free app is a complete, honest tracker — logging is
never held hostage, and the import/export path means even free users can use
any AI they like to draft programs. Pro gates the two things that are
expensive-to-build and high-perceived-value: the analytics queries (§5) and the
MCP surface. This is a **product knob, not a schema decision** — moving a
feature across the line means moving a `requirePro` middleware check, nothing
more. What is structural is the enforcement shape: `requireAuth` on everything,
`requirePro` on exactly two route groups (analytics, MCP tools), checked from
the local columns and hardcoded-entitled until step 5 of the build plan.

Webhooks are the only writer of these columns, and Stripe redelivers, so they
need a dedupe table:

**Not yet in `schema.ts`** — lands with step 5. Until then this block is the spec:

```sql
CREATE TABLE processed_stripe_events (
  event_id     TEXT        PRIMARY KEY,   -- Stripe's evt_… id
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Insert the event id and apply the state change in **one transaction**; a
duplicate delivery hits the primary key and is discarded. Stripe's event ids are
its own strings and this is the one table that is not keyed by a UUID of ours —
that is correct, since the whole point is to match Stripe's identifier exactly.

Two ordering hazards worth knowing before step 5. Stripe does not guarantee
webhook delivery order, so a `customer.subscription.updated` can arrive after
the `deleted` that supersedes it; compare against the event's own timestamp, or
re-read the subscription from Stripe when applying. And Checkout can complete
before your `checkout.session.completed` handler runs, so the user may land back
in the app un-entitled for a second — poll or refetch on the success page rather
than trusting the redirect.

**These columns exist from day one, before Stripe does.** Set them by hand in
seed data and write every entitlement check against them as each endpoint is
built. Retrofitting entitlement across forty endpoints once they all exist is
the expensive version of this.

---

## 4. Deletion and history

| Relationship | Rule | Why |
|---|---|---|
| user → everything | `CASCADE` | See the Clerk deletion note below. |
| program → plan → workout → planned_exercise → planned_set | `CASCADE` | The program owns its whole tree. |
| session → session_exercise → session_set | `CASCADE` | The session owns its sets. |
| workout ← session | `RESTRICT` | You cannot delete a workout that has logged history. |
| exercise ← planned/session exercise | `RESTRICT` | Retire with `is_active = FALSE` instead. |
| planned_exercise ← session_exercise | `SET NULL` | Editing a plan orphans the link, never the log. |

Net effect: a program with logged sessions cannot be deleted — set
`status = 'ARCHIVED'`. This is deliberate. The legacy schema silently orphaned
child rows on every delete.

**Account deletion under Clerk.** Clerk's `user.deleted` webhook is the one
webhook worth wiring up, because Clerk removing the identity leaves this
database holding orphaned training data. Note the interaction: `users` cascades
to everything, so handling that webhook with a plain `DELETE FROM users`
irreversibly destroys the account's entire history, ignoring the `RESTRICT`
rules above (a cascade from the parent overrides nothing, but it does mean one
statement wipes years of logs).

**Decided: soft-delete, then purge.** The webhook stamps `deleted_at` and
returns; a scheduled job hard-deletes afterwards and lets the cascade do its
work:

```sql
-- webhook handler; a redelivery leaves the first timestamp alone
UPDATE users SET deleted_at = now()
WHERE clerk_user_id = $1 AND deleted_at IS NULL;

-- purge job
DELETE FROM users WHERE deleted_at < now() - INTERVAL '6 months';
```

This buys a recovery window for accidental or fraudulent deletion while still
satisfying a genuine erasure request, since the data does actually go. **The
window is 6 months** — deliberately generous, on the reasoning that years of
training history is painful to lose and a deleted account costs almost nothing
to keep. It is a policy knob, not a schema constraint: changing it is one
`INTERVAL` literal in the purge job.

One distinction worth being aware of, if it ever matters: 6 months is long for
an explicit *erasure request* (the usual reading of "without undue delay" is
closer to 30 days). If the app ever needs to honour those separately, the same
`deleted_at` column supports it — an erasure request purges on the next job run
instead of waiting out the window. Nothing in the schema needs to change for
that; it is a branch in the handler.

Three consequences worth knowing:

- **A soft-deleted user is already inert.** Clerk has destroyed the identity, so
  they cannot authenticate and no request can reach their rows. The
  `deleted_at IS NULL` filter therefore matters for admin and analytics queries,
  not for the request path.
- **Re-signup does not restore anything.** Clerk issues a *new* `clerk_user_id`,
  so the JIT upsert (§3.2) creates a fresh row and the old history stays
  attached to the old one. Reuniting them would be a deliberate support action
  against the old row before its purge date, not something that happens
  automatically.
- **The purge is the one place the `RESTRICT` rules are bypassed**, by design.
  Everything below `users` is `CASCADE`, so a single `DELETE` removes programs,
  plans, sessions, and sets regardless of the archive-don't-delete rule that
  governs normal use.

---

## 5. Key queries

**Where am I now?** — replaces the legacy `users.nextWorkout` integer pointer.
Derived, so it can never drift out of sync.

**Decided: sequencing only, no calendar.** There are no target dates per cycle
or per workout. `workout_programs.start_date` is a label recording when a block
began; it schedules nothing. Progress is purely "the next workout you have not
completed", which this query answers, and `workout_sessions.performed_at`
records when each one actually happened. A missed week therefore needs no
catch-up logic — nothing was ever behind.

```sql
SELECT w.id, w.name, p.cycle_number
FROM workout_programs pr
JOIN workout_plans p ON p.program_id = pr.id
JOIN workouts       w ON w.plan_id    = p.id
WHERE pr.user_id = $1
  AND pr.status  = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM workout_sessions s
    WHERE s.workout_id = w.id
      AND s.status IN ('COMPLETED','SKIPPED')
  )
ORDER BY p.cycle_number, w.position
LIMIT 1;
```

Note `SKIPPED` in that predicate. Matching only `COMPLETED` is a bug: a
deliberately skipped workout would stay "next" forever and wedge the program
behind it. A skipped workout is *resolved* — it just has nothing logged under
it. `IN_PROGRESS` is correctly absent, so an abandoned half-finished session
still shows as the thing to return to.

**Best bench set this month** — the query the legacy schema could not answer
without parsing twelve string columns. Two things to copy from it: it aggregates
`weight_kg`, not `weight`, because aggregating the as-entered column is wrong the
moment one row is logged in the other unit (§2.5); and it filters on
`exercise_id`, never on `exercises.name`. Matching an exercise by its name string
is the legacy mistake in §6, and it silently returns nothing the day a user
renames a custom exercise.

```sql
SELECT MAX(ss.weight_kg) AS top_weight_kg
FROM session_sets ss
JOIN session_exercises se ON se.id = ss.session_exercise_id
JOIN workout_sessions  s  ON s.id  = se.session_id
WHERE s.user_id = $1
  AND se.exercise_id = $bench_press_id
  AND ss.parent_set_id IS NULL
  AND ss.kind <> 'WARMUP'
  AND s.performed_at >= $month_start;
```

`$month_start` is computed by the **client** from the user's local timezone and
passed in — not `date_trunc('month', now())` on the server, which uses server
time and puts a 9pm workout on the 31st in Honolulu into the wrong month. The
rule generalizes: any date-bucketed stat ("this week", "this month", per-day
charts) takes its boundaries from the client or from a stored user timezone,
never from the server clock.

**Cycle-over-cycle progression** — group the same query by `p.cycle_number` to
get the chart that justifies the whole program structure. Cycle buckets need no
timezone care — they come from `cycle_number`, not dates.

---

## 6. Dropped from legacy

| Legacy | Replacement |
|---|---|
| `users.password` (plaintext, returned by `GET /api/users`) | Removed entirely — Clerk owns credentials. No legacy password carried over. |
| No authorization on any endpoint | Clerk authenticates; every query scopes on `user_id` (§3.2). |
| String joins on `user` / `workoutPlan` / `workoutDay` / `exercise` | Integer FKs, every one indexed. |
| `repsSet1..6` / `weightSet1..6` as `varchar` | `session_sets` rows, typed, uncapped. |
| `''` means "set not performed" | Absent row. |
| `data.sets` / `workoutPlans.sets` derived-and-stored | `COUNT(*)` of set rows. |
| `users.workoutPlan` + `nextWorkout` denormalized state | Derived from `status = 'ACTIVE'` + session history. |
| `workoutPlan_id` / `workoutDay_id` pointing at tables that never existed | Real tables. |
| `order` (SQL reserved word) | `position`. |
| `varchar(45)` on notes (truncated real data mid-sentence) | `TEXT`. |
| No unit on weight | `weight_unit` stamped per row + generated `weight_kg` for aggregation. |
| Table names `data`, `exerciseList` | `workout_sessions`, `exercises`. |

Separately, and independent of this rewrite: `legacy-overview.md` §0 lists live
RDS credentials committed to git history. If that instance is still running,
those need rotating regardless of what happens here.

---

## 7. Settled decisions

| # | Question | Decision |
|---|---|---|
| 1 | Database engine | **PostgreSQL** (§3). Partial unique indexes, deferrable constraints, and `num_nonnulls` stay database guarantees rather than app conventions. |
| 2 | Cycle variation | **Materialized** — one `workout_plans` row per cycle (§2.1). |
| 3 | Plan sharing | **None.** Copy-from-old-program is a deep copy (§2.2). |
| 4 | Per-set prescription | **Optional** (§2.3). |
| 5 | Tracking variety | **Composable metrics** + typed nullable columns, not EAV (§2.4). |
| 6 | Weight units | **Stamped per row**, generated `weight_kg` for aggregation (§2.5). |
| 7 | Per-exercise unit override | **Yes** — on `user_exercise_settings`, not `exercises` (§2.5, §3.4). |
| 8 | Identity | **Clerk**, with a local `users` anchor row (§2.6). |
| 9 | Supersets / drop sets | **`group_key`** across exercises, **`parent_set_id`** within one (§2.8). Logged only, never prescribed. |
| 10 | Placeholder slots | **Free text**, no muscle-group coupling (§2.9). |
| 11 | `exercises.muscle_group` | **Keep as free `TEXT`.** Browsing and filtering only; nothing depends on it. |
| 12 | Rest periods | **Notes, not columns** (§3.7). Additive later if needed. |
| 13 | Cycle scheduling | **Sequencing only**, no calendar (§5). |
| 14 | Account deletion | **Soft-delete, then purge** (§4). |
| 15 | Purge retention window | **6 months** (§4). One `INTERVAL` literal in the purge job. |
| 16 | Legacy docs | **Kept as reference.** Not migrated, not deleted. |
| 17 | Program length | **`target_cycles SMALLINT NULL` on `workout_programs`** (§2.10). A number is fixed, `NULL` is open-ended. |
| 18 | `set_type` values | **Three** — `NORMAL`, `WARMUP`, `DROP` (§2.8). More are one `ALTER TYPE` away. |
| 19 | Primary keys | **UUIDv7, minted in application code**, on every table (§2.11). |
| 20 | Offline | **Optimistic writes + a durable queue**, not full local-first (§2.11). No `updated_at` sprawl, no tombstones, no sync engine. |
| 21 | Billing state | **Cached on `users`** from Stripe webhooks, with a dedupe table (§3.8). Present from day one. No `sub_tier` column — one paid tier, derivable from `sub_status`. |
| 22 | Database host | **Neon**, WebSocket driver (§3). |
| 23 | Pre-authored cycle variation | **Confirmed as a real requirement** (§2.1) — this is what justifies full materialization over lazy clone-on-demand for fixed programs. |
| 24 | "Apply to remaining cycles" | **Edit-time only, explicit per-cycle confirmation** (§2.1, `operations.md` §3.8). Never silently skips; never offered after the fact. |
| 25 | Free / Pro boundary | **Logging, program building, and import/export are free; progression analytics and the MCP connector are Pro** (§3.8). A product knob — moving a feature is moving a middleware check. |
| 26 | AI integration | **Two doors, both bring-your-own-AI**: a published JSON import/export format any chatbot can target (free, universal), and an MCP server for live read/write (Pro). No developer-paid inference, no bring-your-own-API-key (`workout-tracker-build-plan.md` steps 4 and 6). |
| 27 | Generated unit columns | **No `ELSE` in the conversion `CASE`s** (§2.5) — an unmapped enum value yields `NULL` (visible) instead of converting as pounds (silent). |
| 28 | Market | **US only.** Stripe direct (no merchant of record), USD pricing, Stripe Tax for state digital-goods tax. No geo-gating code — "US only" is a billing posture, not a firewall. |
| 29 | Stat date buckets | **Client-supplied boundaries** from the user's timezone, never server `now()` truncation (§5). |

### Still open

The table above records decisions, not certainties. These are the ones most
likely to be revisited, and knowing which they are matters more than the count:

- **The offline boundary.** §2.11 assumes one device at a time. The first user
  who logs on a phone and a tablet in the same session breaks that assumption,
  and the answer then is `updated_at` plus last-write-wins on `session_sets`,
  not a sync engine. Worth re-reading before adding any multi-device feature.
- **One active program per user** (`one_active_program_per_user`). Someone
  running a lifting block and a running block at once cannot. This is a real
  product limit, not a technical one; changing it means dropping the index and
  deciding what "what's next?" returns.
- **Rest periods** (#12) will get asked for. The migration is one nullable
  column; the UI work is the real cost.
- **`exercises.muscle_group` as free text** (#11) is fine until the first
  "show me everything that hits quads" feature, which needs a controlled
  vocabulary and a backfill.
- **The exact Free/Pro line** (#25) will move as real users react to it. The
  enforcement shape (`requirePro` on route groups) is what makes moving it
  cheap; keep it that way.

---

## 8. Mid-workout deviation — worked scenarios

Validation that the schema handles real gym behaviour. Every one of these writes
only to `session_*` tables; the plan is untouched (§2.7).

### 8.1 Substituting an exercise (the rack is taken)

Already supported, no new columns needed. The session row records what you
*did*; `planned_exercise_id` records which slot it satisfied:

```sql
INSERT INTO session_exercises
  (session_id, exercise_id, planned_exercise_id, position, substitution_note)
VALUES ($session, $dumbbell_bench_id, $planned_barbell_bench_id, 0, 'rack taken');
```

A substitution is then simply a session row whose `exercise_id` differs from its
planned row's — nothing needs to flag it:

```sql
SELECT se.id
FROM session_exercises se
JOIN planned_exercises pe ON pe.id = se.planned_exercise_id
WHERE se.exercise_id <> pe.exercise_id;
```

The corollary is that a **skipped** exercise is a planned row with no session
row pointing at it, and an **improvised** exercise is a session row with
`planned_exercise_id IS NULL`. All three deviations fall out of the same link.

### 8.2 Doing 3 of 5 sets

Nothing to delete — a set that did not happen is simply **no row**. The plan
still says `target_sets = 5`, the log holds 3, and the gap is queryable.

This does imply a UI rule worth stating: **do not pre-create empty set rows**
when a session starts. Render the prescription from `planned_sets` as a
checklist and `INSERT` only when the user actually logs a set. If you pre-create
instead, "I only did 3" becomes a `DELETE`, and deleting set 3 of 5 leaves
`set_number` gaps (1, 2, 4, 5) that you then have to renumber. Insert-on-log has
neither problem.

If you *do* want mid-session removal of an already-logged set, delete the row
and renumber the survivors in the same transaction. `UNIQUE
(session_exercise_id, set_number)` is `DEFERRABLE INITIALLY DEFERRED` (§3.6)
precisely so that renumbering does not trip it halfway through.

Offline, the same deletion happens locally first and reaches the server as a
delete plus a renumber in the flush queue — so the queue must preserve ordering
per session exercise, and the renumber must be sent as one transaction rather
than as N independent updates.

### 8.3 Adding sets

Nothing constrains logged sets to `target_sets` — that column is a target, not a
limit. Log `set_number` 6 and 7 and they are simply extra volume. "Did I hit the
prescription?" compares the two numbers; it does not enforce them.

### 8.4 Supersets, drop sets, myo-reps

Per §2.8, two mechanisms. A superset of bench and row:

```sql
-- same group_key = one superset; order within it is `position`
UPDATE session_exercises SET group_key = 1 WHERE id IN ($bench, $row);
```

A drop set — 100×8 dropping to 80×6 then 60×4 — is one working set with two
children:

```sql
INSERT INTO session_sets (session_exercise_id, set_number, reps, weight, weight_unit, kind)
VALUES ($se, 3, 8, 100, 'LB', 'NORMAL') RETURNING id;   -- the working set

INSERT INTO session_sets
  (session_exercise_id, set_number, reps, weight, weight_unit, kind, parent_set_id)
VALUES ($se, 4, 6, 80, 'LB', 'DROP', $parent),
       ($se, 5, 4, 60, 'LB', 'DROP', $parent);
```

`set_number` stays a single flat sequence per exercise, so ordering and the
existing `UNIQUE` both still work; `parent_set_id` supplies the grouping. That
drop set counts as **one** set toward the target, because the children are
excluded by `parent_set_id IS NULL`.

Myo-reps, rest-pause, and cluster sets are the **same shape** — parent plus
children — and today they are logged as `DROP`, because that is the only
extension label the enum carries (§2.8). If distinguishing them is ever wanted,
it is `ALTER TYPE set_type ADD VALUE 'MYO'` and nothing else: no backfill, no
structural change, no query rewrite.

None of this is prescribable. `planned_sets` has no `kind` and no
`parent_set_id`, so a drop set is something the log records, not something the
plan asks for.

### 8.5 Placeholder slots

Plan the slot without an exercise:

```sql
INSERT INTO planned_exercises (workout_id, placeholder_label, position, target_sets)
VALUES ($leg_day, 'Quads', 2, 4);
```

`exercise_id` stays `NULL`; the `CHECK` allows exactly one of the two. Prescribe
sets against it as normal — though a placeholder's `planned_sets` sensibly carry
rep targets and not weight targets, since the weight depends on what gets
chosen.

On the day, resolving it is exactly §8.1 with no substitution note: insert a
`session_exercises` row with the concrete `exercise_id` and
`planned_exercise_id` pointing at the slot. Over 12 cycles you then get a real
answer to "what did I actually put in the Quads slot each week", which a
free-text note could never give you.

### What is *not* handled

- **Reordering mid-session** (doing exercise 3 before exercise 1) works —
  `session_exercises.position` is independent of the plan's — but the `UNIQUE`
  is `DEFERRABLE`, so do the shuffle inside one transaction.
- **Splitting one planned exercise into two session entries** (half the sets on
  the barbell, half on dumbbells after the rack frees up) is two
  `session_exercises` rows sharing one `planned_exercise_id`. That is legal
  today — there is no unique constraint on `(session_id, planned_exercise_id)`,
  and there should not be. Set numbering restarts per session exercise, so treat
  them as two entries, not one split.
- **Intra-set rest for cluster/rest-pause** is prose in
  `planned_exercises.notes`, by decision (§3.7) — there is no structured rest
  column to query or drive a timer from.
- **Prescribing a drop set** is not supported by decision (§2.8). Write it in
  `planned_exercises.notes` ("last set: drop twice") and let the log record what
  actually happened.
- **Two devices in one session.** The offline queue (§2.11) assumes a single
  device, and `set_number` is assigned client-side. Two phones logging the same
  session would collide on `UNIQUE (session_exercise_id, set_number)` at flush
  time. Accepted, deliberately — see "Still open" in §7.
