# Proposal

## Why

Step 3 shipped the core loop, but the only way to get a program is one of
three test templates; "Create from scratch" just announces the builder. Step
4 of the build plan ("Broaden") starts with the program builder because
everything after it depends on its create path: import (4b) is a front end to
the same create function (`operations.md` §3.13), and mid-workout deviations
(4c) only matter once programs can contain placeholders and non-barbell
exercises. Signed-out visitors also see only a Clerk form at
`tanrenstrength.com`, with nothing saying what the app is. The user wants the
landing page from the chosen mockup (`design/mockups/7-stroke-order.html`) to
be the first thing they see, after reviewing and changing it together.

This is slice 4a of five. The order the user chose is 4a, then a user-led
design pass on the workout screen, then 4b (import/export), 4c (mid-workout
deviations), 4d (history and progression), 4e (account and ops).

## What Changes

- **A design session with the user comes first and gates all UI work.** We
  review mockup 7's landing page and change it together. Then we go through
  rough layouts for the signed-in home (programs, drafts, entry to the
  builder) and for the builder, and work out the chosen layouts in detail. No
  UI task in this change starts before its surface has been agreed.
- **Landing page.** A signed-out visit to `/` shows the agreed landing page.
  "Log in", "Get started" and the trial call to action lead to Clerk's sign-in
  or sign-up. Signed-in users go straight to the app.
- **Exercise catalog** (`operations.md` §2.1–2.4). Browse and filter standard
  and own exercises. Create a custom exercise with its metrics. Rename or
  reclassify your own. Record setup and cues for any exercise. Retire your
  own.
- **Program builder** (§3.1–3.6). Create a fixed-length or open-ended program
  by composing cycle 1: workouts, exercises or placeholder slots, target
  sets, optional per-set prescriptions, and supersets. It is created in one
  transaction, and a fixed program is materialized through the clone
  primitive. New programs start as DRAFT.
- **An effort target per prescribed set:** RIR or RPE, never both. The user
  asked for it in the design session. This adds a `target_rir` column (design
  D16). Logging still records weight and reps only.
- **Editing a cycle** (§3.7), with **apply to remaining cycles** (§3.8)
  offered in the same save. The structural-fingerprint guard pre-checks each
  later cycle, cycles that look authored are unchecked and annotated, and
  trained cycles are excluded.
- **Program lifecycle** (§3.9–3.12). List programs. Copy from an old program,
  auto-suffixing a colliding name. Activate, archive, rename, and extend a
  fixed program by one cycle.
- **Templates start through the same create path.** "Create from scratch" now
  opens the builder. **BREAKING** for the `program-templates` spec: its
  "announced, not built" requirement is replaced.
- **Skip a whole workout from home** (§4.14), pulled forward from 4c at the
  user's request. It writes a SKIPPED session through the offline queue, and
  skipping a cycle's last workout rolls the program over exactly as finishing
  does. Home can also **finish a forgotten workout and start the next one** in
  one action.
- **Logger stopgap.** The workout screen shows placeholder slots and exercises
  it can't log yet (anything other than weight and reps) as "logging arrives
  soon", with Skip, so the workout can still be finished. Until now,
  placeholders silently dropped out of the workout context.
- **Service functions, Zod contracts and routes** for all of the above, with
  `requirePro` on every write. These features are online-only (`operations.md`
  §0.3), so they use no mutation queue.

## Capabilities

### New Capabilities

- `landing-page`: what a signed-out visitor sees at `/` and how it leads to
  sign-in or sign-up; the same page at `/about` for everyone, with "Open
  app" for someone signed in.
- `exercise-catalog`: browsing, creating, annotating and retiring exercises.
- `program-builder`: creating a program and editing its cycles, including
  apply to remaining cycles.
- `program-lifecycle`: the program list, copy, activate, archive, rename and
  extend.

### Modified Capabilities

- `program-templates`: "Create from scratch" opens the builder instead of
  announcing it.
- `workout-sessions`: the workout screen shows placeholders and exercises it
  can't log yet, instead of dropping or mis-rendering them.
- `offline-logging`: a new version installs itself when that is safe (no
  workout in progress on the device), and only prompts mid-workout (D18,
  added after the 4a deploy).

## Out of scope

- **Import/export and the published format page** (§3.13, §5.4). That's 4b.
  This change builds the create function import will call.
- **Filling placeholders and logging timed, bodyweight or checkbox sets**
  (§4.6, §4.12), and the other mid-workout deviations except skipping a whole
  workout, which the user pulled into this change. That's 4c; this change ships only the stopgap above, which
  the user chose over restricting the builder.
- **Redesigning the workout (logging) screen.** That's the user-led design
  pass right after 4a. Here it only gains the stopgap rows.
- **Per-exercise unit overrides and the default unit setting** (§1.2, §1.3),
  even though overrides share a row with setup and cues. They belong to 4e,
  and logging already resolves units from what is stored.
- **Deleting a program.** No operation in `operations.md` covers it, and
  §3.11 makes archive the intended end state. Writing a delete for untrained
  drafts needs that operation written first.
- **Changing an exercise's metrics after creation.** Logged sets were
  validated against them. A different metric set is a new exercise.
- **Propagating an edit after it was saved.** §3.8 makes this edit-time only
  by decision (`data-model.md` §7 #24).
- **Landing page claims for features not built yet** (analytics, the AI
  connector, pricing). How the page presents them is decided in the design
  session. No price is shown before step 5 sets one.
- **Prerendering the landing page for search engines.** It renders in the
  SPA; static prerendering can be added later without changing behaviour.

## Impact

- `packages/db`: a cycle-fingerprint helper beside the clone, and one
  generated migration adding `planned_sets.target_rir` (D16).
- `packages/shared`: contracts for exercises, program trees, cycle saves,
  apply previews and the program list.
- `packages/services`: catalog, create, cycle edit with apply, copy,
  activate, archive, rename and extend. Template start is refactored onto
  create, and the workout context now returns placeholders.
- `apps/api`: exercise and program routes, with `requirePro` on writes.
- `apps/web`: the landing page, home's programs area, the builder, an
  exercise picker and catalog screen, and the logger stopgap. Routing for
  signed-out `/`, and code splitting so the landing page doesn't wait on the
  app bundle.
- Docs: `operations.md` gets any behaviour this change pins down that it
  doesn't already state, such as fingerprint normalization and which edits a
  trained workout allows.
