# Design

## Context

See proposal.md for motivation and specs/ for the requirements. The operations
are specified in `docs/operations.md` §2.1–2.4 and §3.1–3.12. This file
records only the decisions those sections leave open.

What already exists:

- **`clonePlan` in `packages/db/src/clone.ts`.** It handles all three callers,
  both target shapes (a new plan row, or replacing an existing plan's
  subtree), and the id maps a rerun reuses.
- **`createProgramFromTemplate`** in `packages/services/src/templates.ts`.
  It writes a DRAFT program, materializes cycle 1 and activates it. It also
  holds `freeProgramName`, the §3.9 auto-suffix.
- **`finishWorkout`.** It locks the program row `FOR UPDATE`, then extends an
  open-ended program or completes a fixed one (`advanceProgram`, ACTIVE
  only).
- **`getWorkoutContext`.** It inner-joins `exercises`, so a placeholder slot
  silently drops out of the workout.
- **The web app.** `main.tsx` statically imports Clerk, the data layer and
  the app, and renders once IndexedDB is read. `AuthGate` uses the device's
  last-user record to skip Clerk, and otherwise shows Clerk's sign-in.
- **The schema.** The plan tables needed only one change, `planned_sets.
  target_rir` (D16), added by a generated migration. The position uniques
  are already deferrable (`packages/db/CLAUDE.md`), so reordering needs none.

## Goals / Non-Goals

**Goals:**

- Have exactly one function that creates a program tree. Manual create,
  template start, copy, and next change's import all go through it.
- Make the cycle save the only plan-editing write, so that "apply to
  remaining cycles" is in the same transaction as the edit by construction.
- Paint the landing page without the Clerk and app bundle (about 830 KB
  gzipped today).

**Non-Goals:**

- A general-purpose undo or version history for plans. The guard compares
  against the pre-edit state only for the length of one save.
- Server-side filtering or pagination of the catalog and the program list
  (D13).

## Decisions

### D1. The design session gates every UI task, in a fixed order

The user shapes three surfaces with the orchestrator, in this order:

1. The landing page: we review `design/mockups/7-stroke-order.html` and
   change it.
2. The signed-in home: the programs area and the builder entry.
3. The builder: the cycle editor, the slot and set editor, the exercise
   picker and the apply-to-cycles confirmation.

For each surface we compare rough layouts, the user picks one, and we work it
out in detail. Each agreed surface is recorded as an Impeccable surface brief
before any agent builds it. Server work (groups 2–5 in tasks.md) doesn't wait
on the session, because the operations are already pinned down in `docs/`.
*Rejected: agents build in the existing design system and the user reviews
afterwards.* The user asked to shape these surfaces themselves.

### D2. The landing page is a separate entry chunk, picked by the device hint

`main.tsx` becomes a small bootstrap that reads the device's last-user record
from IndexedDB, which takes milliseconds.

- **Record present:** it dynamically imports the app chunk (Clerk, the data
  layer, the router) and renders it as today. Offline behaviour (step 3, D10)
  is unchanged.
- **No record:** it renders the landing chunk, which has no Clerk and no data
  layer. Once the page has painted, it fetches the app chunk in idle time.
  If Clerk then reports a session (a signed-in user whose device record was
  cleared), the bootstrap swaps to the app. This is how the "signed-in users
  go straight to the app" requirement holds without blocking the paint.
- **Calls to action** load the app chunk and open Clerk's sign-in or sign-up
  mounted at `/sign-in` and `/sign-up`.

The service worker already precaches every chunk, so this doesn't change
offline behaviour.
*Added after the 4a deploy:* `/about` is the landing page for everyone. The
bootstrap picks the landing chunk there whatever the device record says,
and passes the record as `signedIn`, so the calls to action read "Open app"
(home) from the first paint without Clerk. The idle-time session check
still runs behind it, but at `/about` a session only turns the calls to
action to "Open app"; it never swaps the page for home. Once the app is
running, `/about` is a route outside `AuthGate` rendering the same lazy
chunk, reached from "About Tanren" in the account menu (Clerk's
`UserButton` menu, between Manage account and Sign out), so the header's
two links stay the daily ones.

*Rejected: a static `landing.html` served at `/` by CloudFront.* That needs a
second build entry and CloudFront and S3 routing changes, and it splits the
theme tokens across two pages.
*Rejected: prerendering.* It's extra tooling, and search ranking isn't a goal
of this change.

### D3. One create function takes the whole first cycle

`createProgram(db, user, { programId, name, targetCycles, cycle })` takes
cycle 1 as a tree in which every id is client-minted: the plan, the workouts,
the slots and the sets. In one transaction it inserts the tree level by
level, then calls `clonePlan` `targetCycles − 1` times with server-minted
ids. A new program is a DRAFT.

Replaying the request is detected by the program id. If the id exists and is
the user's, the function compares the stored cycle 1's fingerprint (D6) with
the request's. If they match, it returns the program. If they differ, it
throws `conflict`.

There is one create path, in steps: the replay check (`isReplay`, D17), the
name rule (D9), the program row (`insertProgramRow`), cycle 1, then the
clones (`fillCycles`). Template start becomes "template → cycle tree →
`createProgram`, then activate", in the same transaction. Copy (§3.9) is the
same path with a different cycle 1: it locks the source, inserts the program
row under a free name with the source's notes and length, clones the
source's cycle 1 as cycle 1, then fills. It replays by the same rule.
*Rejected: creating an empty DRAFT and building it with per-row endpoints.*
That leaves a half-built program on the server, costs one round trip per
edit, and isn't the one-call shape import needs. §3.1 also asks for one
transaction.

### D4. Editing is a whole-cycle save that the server diffs

The builder edits a copy of one cycle in the client and saves the whole
desired tree, keeping existing ids and minting new ones.
`saveCycle(db, user, { programId, cycleNumber, cycle, expected, applyTo })`
then runs in one transaction:

1. Lock the program row `FOR UPDATE`. This is the lock `finishWorkout`
   already takes, so a save and an extension are serialized.
2. Check the stale guard (D7).
3. Diff the stored cycle against the request, in order: delete rows that are
   missing, update rows that are kept, insert rows that are new. The
   deferred position uniques allow reordering.
4. Replace each `applyTo` cycle's subtree with `clonePlan` using
   `{ existingPlanId }`.

Keeping ids matters because `session_exercises.planned_exercise_id` points at
planned rows. Delete-and-recreate would turn logged exercises into
"improvised" ones (`SET NULL`), and a trained workout would refuse to be
deleted at all (`RESTRICT`).
*Rejected: per-field PATCH endpoints.* The apply step couldn't share the
edit's transaction, which §3.8 requires.
*Rejected: delete and recreate the cycle,* for the reasons above.

### D5. "Trained" means any session row, at two granularities

A **workout** is trained if any `workout_sessions` row references it,
whatever its status, so an IN_PROGRESS session counts. A trained workout is
frozen: the diff refuses any change to its row or its subtree, any change to
its position, and so any insert before it.

A **cycle** is trained if any of its workouts is. Trained cycles are never
apply targets. That's the up-front query §3.8 asks for, with `RESTRICT` left
as the backstop.

The rule is written into `operations.md` §3.7, because the docs didn't say
what editing a trained workout does.
*Rejected: freezing the whole cycle once any workout is trained.* It blocks
the common mid-cycle tweak ("bump Thursday's bench").
*Rejected: allowing edits to trained workouts.* It rewrites what plan-versus-
actual (§5.3) compares against.

### D6. `cycleFingerprint` lives beside the clone, in `packages/db`

The fingerprint is a SHA-256 over a canonical JSON form of a cycle:

- each workout's name and position;
- each slot's exercise id or placeholder label, position, `target_sets` and
  group;
- every prescribed-set target column.

Notes are excluded (§3.8). Group keys are renumbered by first appearance
within a workout, so `{1,1}` and `{7,7}` produce the same fingerprint. The
same normalizer runs over a stored cycle and over a request tree, which is
how D3 compares a replay and how D7 compares an edit.

The normalizer is the one place that decides what counts as authoring.
*Rejected: a stored version or hash column.* §3.8 calls for neither, and a
stored value goes stale.

### D7. The apply preview is a read, and the save re-checks it

`GET /api/programs/:id/cycles/:n/apply-preview` returns:

- the edited cycle's fingerprint, before the edit;
- for every later cycle: its fingerprint, whether it is trained, and whether
  it matches the edited cycle.

The client pre-checks the cycles that match and are untrained, annotates the
others, and sends `expected = { source }` and `applyTo = [{ cycleNumber,
fingerprint }]` with the save. `source` is the fingerprint the cycle read
returned when the editor loaded the cycle (D17), not the preview's, so the
guard spans the whole load-to-save window; each chosen cycle carries the
fingerprint the preview showed for it, so the two can't disagree. Inside the
save's transaction, after the lock:

- **Everything as previewed:** the source and every chosen target still
  match their expected fingerprints, and no target is trained. The save goes
  ahead.
- **Already done:** the source and every chosen target already have the
  desired tree's content key (`cycleContentKey`: the fingerprint's content
  plus every workout, slot and set `notes`). The save succeeds and writes
  nothing. This is how a retried save stays idempotent with no request-id
  table. Because the key includes notes, a retry after another device
  changed a note on the edited cycle or a target is a `conflict`, not an
  overwrite of that note. (An earlier version compared fingerprints alone
  and rewrote the notes.) Since an already-done save clones nothing, the
  apply step needs no trained re-check of its own.
- **Anything else:** `conflict`, "reload and try again".

The pre-edit state exists only between the load and the save, so "apply an
edit after it was saved" can't be expressed.
*Rejected: computing the guard after the save.* The pre-edit source no longer
exists by then, which is the reason §3.8 gives for edit-time only.

### D8. Every write to an existing plan takes the program lock

Saving a cycle, copying a program (it locks the source while it reads),
extending, activating, archiving and renaming all lock the program row
`FOR UPDATE`, just as finish does. A fixed program's "extend" and a finish's
completion can't interleave, so neither can leave the cycle count off by one.

Extend takes a client-minted `newPlanId`. A replay finds that plan already
there and returns without writing anything.

Three gaps, closed during implementation and review:

- **Activating a program whose workouts are all resolved.** A finish or skip
  under an ARCHIVED program never rolls it over (§4.13), so an archived
  program can end up with every workout resolved. Activation now runs the
  finish's exhaustion check (`advanceProgram`) in the same transaction: an
  open-ended program gains its next cycle, and a fixed one becomes COMPLETED.
  An ACTIVE program is never left with nothing next.
  *Rejected: refusing to activate it.* For an open-ended program that's a
  dead end the user can't get out of, because extend refuses open-ended
  programs.
- **Adding to a COMPLETED program.** Every workout of a COMPLETED program is
  resolved, so all of them are frozen (D5). The freeze still allows a new
  workout, and that would leave the program COMPLETED with an unresolved
  workout. `saveCycle` refuses any new workout or slot in a COMPLETED program
  with `invalid`: "This program is finished. Run another cycle to change it."
  *Rejected: reopening the program as ACTIVE on such a save.* COMPLETED would
  then be undone by an edit rather than by extending, which is the one way
  §3.12 gives for running a finished program again.
- **A save that removes the last unresolved workouts.** The freeze lets a
  save delete untrained workouts, so a save can leave an ACTIVE program with
  every remaining workout resolved: nothing next, and an open-ended one
  stuck, because extend refuses it and activate is a no-op on it. `saveCycle`
  now ends with `advanceProgram` under the lock it already holds, as finish,
  skip and activate do: a fixed program becomes COMPLETED, an open-ended one
  gains its next cycle. An ordinary save leaves something unresolved and the
  check does nothing; a retried save finds the roll-over already done.
  *Rejected: refusing a save that removes the last unresolved workout.* For a
  fixed program, dropping the rest of the last cycle is a legitimate way to
  finish early, and for an open-ended one it is how the user trims a cycle.

With those, §4.13's exhaustion check runs on every write that can resolve or
remove a program's last unresolved workout, and an ACTIVE program always has
something next.

### D9. Name rules are one module

`freeProgramName` moves from `templates.ts` to `services/src/names.ts`.
Template start and copy use it. Manual create and rename check the name
inside the transaction and throw `conflict` with the clash named. The unique
constraint is the backstop, and `transact` already translates it.

The same module checks exercise names. It compares case-insensitively
against the user's own exercises and the standard ones, because the database's
two partial indexes don't stop a custom exercise from taking a standard name
(`data-model.md` §3.3 explains why that would be harmful).

### D10. The program list and cycle reads are batched, never N+1

- `GET /api/programs` returns every program with its status, its cycle count
  (`target_cycles`), and its current cycle. The current cycle is the lowest
  cycle that still has an unresolved workout, using the same
  `resolvingSession` condition as what's-next (`packages/services/CLAUDE.md`).
  It takes one query per level across all of the user's programs.
- `GET /api/programs/:id` returns the program and its cycle numbers, each
  flagged as trained.
- `GET /api/programs/:id/cycles/:n` returns that cycle's tree with each
  workout flagged as trained, in one query per level.

### D11. The exercise catalog is a single read, filtered on the client

`GET /api/exercises` returns every exercise the user can see, with its
metrics. Adding `includeRetired=1` also returns the user's own retired
exercises. Muscle, equipment and name filters run on the client.

Writes:

- `POST /api/exercises` takes a client-minted id. A replay re-reads the
  exercise through `userScope` and returns it.
- `PATCH /api/exercises/:id` updates the name, muscles or equipment of the
  user's own exercise only. It has no metrics field at all.
- `PUT /api/exercises/:id/notes` upserts setup and cues on
  `user_exercise_settings` with `ON CONFLICT (user_id, exercise_id) DO UPDATE`
  of those two columns only, so `default_weight_unit` (§1.3, 4e) is left
  alone.
- `POST /api/exercises/:id/retire` and `/reactivate` apply to the user's own
  exercises only.

### D12. The logger stopgap is a widened context with a "loggable" rule on the client

`getWorkoutContext` left-joins `exercises`. Each slot becomes either an
exercise (as today) or `{ placeholderLabel }` with null exercise fields.

The client treats a slot as loggable only if it is an exercise whose metrics
are exactly REPS and WEIGHT. Every other slot renders the "arrives soon" row
with Skip and no set entry.

The new fields are optional or nullable additions, so contexts that step 3
cached in IndexedDB still parse under the new schema.
*Rejected: hiding unloggable slots.* That's today's bug.
*Rejected: restricting the builder.* The user chose this stopgap instead.

### D13. Lists that stay small are not paginated

The build plan asks for pagination on any list, but two lists here are
bounded by design:

- **The catalog:** the 92 standard exercises plus the user's custom ones.
- **The program list:** one user's programs, tens over years.

Both are fetched whole and cached by TanStack Query. Unbounded lists, such as
history, stay paginated as in step 3.
*Rejected: cursor pagination here.* It adds complexity for no benefit at
these sizes.

### D14. Builder drafts survive a reload, on the device only

The builder state that isn't saved yet (a new program or an edited cycle) is
kept in IndexedDB, keyed by program and cycle, and cleared when it's saved
or discarded. The builder is online-only (§0.3), so this is a convenience
and not a sync mechanism.
*Rejected: keeping it in memory only.* A long build lost to an accidental
back swipe is the failure most worth avoiding here.

### D15. Skipping a workout reuses the session write path and the finish's roll-over

`skipWorkout(db, user, { sessionId, workoutId, performedAt })` inserts one
`workout_sessions` row with status SKIPPED (`ON CONFLICT (id) DO NOTHING`,
then re-read through `userScope`). It then runs step 3's `advanceProgram`
under the same program lock as finish, so skipping a cycle's last workout
extends or completes the program in one place.

On the client, skipping is a queue operation in its own lane, like start. The
device's what's-next view treats a locally skipped workout as resolved, so
home moves on at once, even offline. Skip asks for a one-tap confirmation
naming the workout ("Skip Legs? Pull A moves up"), because there is no undo
operation.

"Finish & start next" queues the existing finish, then the existing start for
the program's next workout as the device computes it.

The server is deliberately more permissive than home. It accepts a skip of any
of the user's workouts that has no session, in any cycle, under a program of
any status; only the roll-over is limited to ACTIVE programs, as for finish
(§4.14). A skip is a queued offline write: when it replays, the device's
"next" may be stale (another device trained, or the program was archived),
and refusing it would stop the queue on a write the lifter made in good faith.
Home offering only the next workout is the UI's rule, not the server's.

The device never offers a resolved workout as next: the stored outline keeps
each workout's `trained` flag from the cycle read, and the successor a skip
or "Finish & start next" targets passes every trained workout (skipped,
finished or started on another device), as well as every one resolved on
this device. A start and a skip are serialized per workout on the device,
so a double tap queues one write.

*Known gap:* a skip the server rejects (our API's JSON 4xx, so the lane
stops at it) keeps its SKIPPED record, so the workout stays resolved on this
device and home stays moved past it, until step 5's discard of a rejected
write. This is the same gap step 3's D7 left for a rejected set (recovering a
rejected write is deferred to step 5); the sync line already names the
stopped lane and its reason.
*Rejected: an undo window that delays the enqueue.* Closing the app inside the
window would silently lose the skip.
*Rejected: leaving skip to 4c.* The user wants it on home in this change.

### D16. RIR is its own column beside RPE, and a set carries at most one

The user asked, during the builder session, for sets to be programmable by
reps in reserve or by RPE. `planned_sets` already has `target_rpe
NUMERIC(3,1)`. This change adds `target_rir NUMERIC(3,1)` with
`CHECK (target_rir BETWEEN 0 AND 10)` and `CHECK (num_nonnulls(target_rpe,
target_rir) <= 1)`, in a generated migration. RPE gets a 1–10 range in the
contract; the database keeps its existing 0–10 check.

Both columns are authored content, so the fingerprint includes both.

The values are stored as written and never converted. The logger shows the
target beside the prescription and logs only weight and reps, as the user
asked.
*Rejected: storing RIR as `10 − RPE` in `target_rpe` with a display toggle.*
That loses which scale the user wrote, and needs a preference column anyway.
*Rejected: free text in set notes.* Notes are excluded from the fingerprint,
and a target is not an annotation.

### D17. Review hardening: the load fingerprint, replay identity, size bounds

Four rules added after the code review, each closing a way a request could be
answered wrongly.

- **The cycle read carries its fingerprint.** `GET
  /api/programs/:id/cycles/:n` returns `fingerprint`, the stored cycle's,
  and the builder sends it as `expected.source` (D7). The preview-to-save
  guard alone missed a save from another device between the load and the
  preview: the preview would show the other device's cycle as the source,
  and this save would overwrite it. The read's level queries, trained flags
  and fingerprint run in one `REPEATABLE READ` read-only transaction, so they
  describe one moment; the apply preview reads the same way. The field is
  required: the endpoint never shipped without it.
- **A create replay must match the stored program.** Besides cycle 1's
  fingerprint (D3), the name and `targetCycles` must equal the request's.
  Template start, whose name may have been suffixed (D9), accepts "Name (n)"
  (`programNameMatches`, the inverse of the free-name rule). A name or length
  difference is `conflict` "That program id is already in use."; a cycle 1
  difference is `conflict` "A different program was already created with
  this id."
- **A copy replay follows the create rule (D3).** A `newProgramId` that is
  already the user's program counts as the copy only if its name is the
  requested one (the source's by default) or "Name (n)", its `targetCycles`
  is the source's, and its cycle 1 fingerprints the same as the source's
  cycle 1. Without this, a reused id answered with an unrelated program as if
  the copy had succeeded.
- **Size bounds in the contract.** `targetCycles` at most 104, at most 14
  workouts per cycle, 40 slots per workout, and 30 for a slot's `targetSets`
  and its prescribed sets (`programLimits` in `packages/shared`), with
  messages that name the workout and slot. They put a ceiling on one
  request, not a small one: a cycle at every limit is about 17,400 rows, and
  a fixed create clones it per cycle. Realistic programs are far below it
  (about 2,600 rows for a whole 12-cycle program, `data-model.md` §2.1). The
  response schemas are not bounded, so a program extended past 104 cycles
  still reads. Because those bounds still allow about 1.8 million rows, a
  create is also refused when `targetCycles` (1 if open-ended) times the
  cycle's workouts, slots and prescribed sets exceeds 20,000
  (`programLimits.rowsPerProgram`), and `extendProgram` refuses a fixed
  program already at 104 cycles (`invalid`).

The services also refuse a tree that uses one id twice (`invalid`, the
contract's message), in `saveCycle` and in the create path. The contract
already refuses it, but the MCP adapter (step 6) must not get a by-id diff
that silently collapses two rows into one.

*Accepted trade-off:* a replay that arrives after the program was renamed,
extended, or had its cycle 1 edited is refused as a conflict. Replays of these
online-only requests are retries seconds later, not after further edits.
*Rejected: a request-id table for exact replay detection.* D7 already chose
fingerprints over stored request ids.

### D18. Updates install themselves when it is safe (amends step 3's D13)

Step 3 kept `registerType: "prompt"` and always asked: a new version waited
for "Reload" so nobody lost their place mid-set. After the 4a deploy, that
left a signed-out visitor on the old landing page indefinitely (the landing
branch registered the worker with no prompt at all), and a signed-in lifter
on an old build until they happened to answer the toast. The worker stays
`prompt` (it never activates by itself); the page now decides, with one
pure function, `updatePolicy` (`apps/web/src/boot/updates.ts`):

| Where the page is | Policy |
|---|---|
| Landing, `/about`, sign-in, sign-up, nobody signed in | `now`: skip-waiting and reload |
| Signed in, no `IN_PROGRESS` session record on this device | `at-safe-moment`: the next route change, or the page going hidden or visible |
| A workout in progress on this device | `prompt`: today's toast, "Reload" and "Later" |

- **One registration per page.** The bootstrap calls `registerSW` once for
  both chunks (`updates.start()` in `main.tsx`); the app's `UpdatePolicy`
  sets the context (route, record, sessions) and reports route changes,
  and `UpdatePrompt` only renders the controller's prompt. Two Workbox
  instances (landing plus app) would each reload the page.
- **Nothing is lost.** The queue and the session records are written in one
  IndexedDB transaction before a write is sent, and an item leaves the
  queue only on its ack, so a reload mid-send resends it (`ON CONFLICT (id)
  DO NOTHING`). Builder drafts flush before the reload (`beforeUpdate`, and
  `hold` on the write in flight). The apply waits while a dialog is open, a
  text field has focus, or a plan-side mutation is in flight; on a public
  page those defer `now` to the next safe moment. A step inside Clerk's flow
  (`/sign-in` to `/sign-in/factor-one`) is not a safe moment.
- **Another tab** that activates the new worker, or upgrades the database
  under this one (`replaced`), goes through the same policy as "updated in
  another tab": a reload at once or at a safe moment, a prompt mid-workout.
- **A page left open** asks for a new worker when it becomes visible, at
  most every ten minutes, so a long-lived tab finds a deploy without a
  navigation.

*Rejected: `registerType: "autoUpdate"`* (the plugin reloads every client
as soon as the new worker activates). It reloads mid-set, the one thing
D13 existed to prevent, and a waiting worker activated by one tab would
reload a workout in progress in another.
*Rejected: keep prompting everywhere, adding the prompt to the landing
page.* A visitor to a marketing page shouldn't be asked to manage versions,
and a prompt the visitor ignores keeps them on stale copy and stale code.

## Risks / Trade-offs

- **The fingerprint misses a column that later starts to matter, so a cycle
  the user authored looks inherited.** → The normalizer is one function with
  a test per included and excluded column. Any later migration to the plan
  tables must update it; the schema-change skill gets that line.
- **The landing page promises something that isn't built.** → The spec
  forbids it, and the design session decides how analytics, the AI connector
  and pricing appear before steps 4d, 5 and 6 ship them.
- **An update reloads a page under someone (D18).** → Only where nothing
  can be lost: never mid-workout, never with a dialog open or a field
  focused, never with a plan-side write on the wire, and drafts flush
  first. The first deploy of D18 still reaches old clients the old way
  (their code has no policy); from then on, updates install themselves.
- **The code split leaves the logger without its chunk offline.** → The
  service worker precaches all chunks. The offline e2e test (step 3's
  `offline.preview.ts`) runs against the split build.
- **A large cycle save stays a single transaction.** About 2,600 rows is the
  documented worst case for a whole 12-cycle program (`data-model.md` §2.1),
  and a save touches one cycle plus its apply targets. → Batched inserts and
  updates per level, as in the clone.
- **The diff refuses a reorder across a trained workout, which users may
  find surprising.** → The refusal names the workout. The builder disables
  moving around trained workouts, so the server rule is rarely seen.

## Migration Plan

Two generated migrations. `0006` adds `planned_sets.target_rir` and its two checks (D16). `0007` makes `planned_exercises.target_sets` `NOT NULL`: every writer (create, save, clone, template start) has always set it, so the wire's `targetSets` is never a guess; the migration fails, rather than inventing a count, if any stored row lacks one. Both must reach production through CI before the API that relies on them is deployed. The deploy order is the usual one: merge, CI
runs (no migrations), the user deploys.

The workout-context contract change is additive, so a device holding a
step-3 cached context keeps working. Rolling back is a redeploy of the
previous build. No data written by this change is unreadable by step 3's
code, except DRAFT programs, which step 3 never lists.
