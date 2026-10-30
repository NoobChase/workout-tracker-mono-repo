# Tasks

## 1. Design session with the user (D1, gates groups 7–9)

- [x] 1.1 Landing page: walk the user through `design/mockups/7-stroke-order.html` section by section and record each change they want. Then decide with them how unbuilt features (analytics, the AI connector), pricing and the "Who uses it" copy appear, within the `landing-page` spec's honesty rule. Verify that an Impeccable surface brief for the landing page exists under `apps/web/.impeccable/surfaces/` and the user has approved it.
- [x] 1.2 Signed-in home: present two or three rough layouts for the programs area (drafts, active, completed, archived, the builder entry, templates), let the user pick one, then work it out in detail. Verify that an approved surface brief exists.
- [x] 1.3 Builder: present rough layouts for the cycle editor, the slot and set editor, supersets, placeholders, the exercise picker and catalog screen, and the apply-to-cycles confirmation (`operations.md` §3.8 wording). The user picks, then we work it out in detail. Verify that an approved surface brief exists covering every builder requirement in `specs/program-builder` and `specs/exercise-catalog`.

## 2. Shared helpers (`packages/db`)

- [x] 2.1 Add `cycleFingerprint` (D6) beside `clonePlan`, with a normalizer that works on both a stored cycle and a request tree. Verify with unit tests: one changed fingerprint per included column (name, position, exercise or label, target_sets, group, each target column); no change for notes; equal fingerprints for group keys `{1,1}` and `{7,7}`. Add a Neon test showing that a stored cycle and its own tree fingerprint the same.
- [x] 2.2 Add a line to the `schema-change` skill: a migration that touches a `planned_*` table or `workouts` must update the fingerprint normalizer. Update `packages/db/CLAUDE.md` for `cycleFingerprint`. Verify every file named exists.

- [x] 2.3 Add `target_rir` to `planned_sets` (D16) per the `schema-change` skill: the column, the 0–10 check and the at-most-one-of-RPE/RIR check in `schema.ts`; a migration generated with `npx drizzle-kit generate --name planned_set_rir`; the fingerprint normalizer; and the `data-model.md` prose. Then the shared contracts (`targetRir`, RPE 1–10, steps of 0.5, refusing both) and the services' cycle write and read paths. Verify: the db schema tests cover both checks; a fingerprint test changes with `targetRir`; a shared test refuses both; a services Neon test round-trips `targetRir` through create, save and the cycle read; regenerating reports no differences.

## 3. Shared contracts (`packages/shared`)

- [x] 3.1 Add Zod schemas for exercises (list, create, edit, notes), the cycle tree (workouts, exercise-or-placeholder slots, prescribed sets, group), create program, save cycle (with `expected` and `applyTo`), apply preview, program list and detail, copy, rename, extend and activate/archive. Extend the workout context with nullable exercise fields and `placeholderLabel` (D12). Verify with unit tests that round-trip valid payloads and reject what the specs name: both or neither of exercise and label, rep max below min, a weight without a unit, more prescribed sets than `target_sets`, non-v7 ids. Add a test that a step-3 workout context still parses.

## 4. Service layer (`packages/services`)

- [x] 4.1 Move `freeProgramName` into `src/names.ts` and add the manual-name and exercise-name checks (D9). Verify with Neon tests: an exact program-name clash is refused with the name in the message; a custom exercise named like a standard one, in any case, is refused; the suffix sequence is (2), (3).
- [x] 4.2 Implement the catalog functions (D11): list (with `includeRetired`), create (idempotent on id, metrics in the same transaction), edit (own only, no metrics), notes upsert (setup and cues only), retire and reactivate (own only). Verify Neon tests for each `specs/exercise-catalog` scenario, including another user's exercise being invisible and a replayed create being a no-op (`xmin`).
- [x] 4.3 Implement `createProgram` (D3) and move template start onto it. Verify Neon tests: a fixed program with 12 identical cycles; open-ended with 1; a failure partway leaves nothing; a replay is a no-op; the same id with different content is a `conflict`; another user's exercise is refused; the existing `program-templates` tests still pass.
- [x] 4.4 Implement the reads (D10): program list with current cycle and progress, program detail with trained flags, cycle tree with per-workout trained flags. Verify Neon tests for statuses, "cycle n of N" against open-ended, cross-user invisibility, and a query count that doesn't grow with the number of programs (assert the statements issued).
- [x] 4.5 Implement the apply preview and `saveCycle` (D4, D5, D7): lock, stale guard, diff (delete, update, insert), frozen trained workouts, and clone over the chosen targets. Verify Neon tests for every `specs/program-builder` editing scenario: a single-cycle edit; apply to 6–12; an authored cycle 9 flagged; notes-only pre-checked; an override of the flag; a trained workout refused by name; a reorder across a trained workout refused; trained-since-preview refused with nothing written; a replayed save writing nothing; a save racing a finish forced with an open transaction holding the program lock.
- [x] 4.6 Implement copy, activate, archive, rename and extend (D8). Verify Neon tests for each `specs/program-lifecycle` scenario, including an independent copy (editing it leaves the source unchanged), the (3) suffix, a replayed copy and a replayed extend each writing once, archive never producing COMPLETED, and activate leaving other programs untouched.
- [x] 4.7 Widen `getWorkoutContext` to return placeholder slots (D12). Verify Neon tests: a placeholder appears at its position with its label; a fixed program finishing its last workout becomes COMPLETED and leaves what's next (the new `workout-sessions` requirement, added as a test if step 3 lacks one).
- [x] 4.8 Update `packages/services/CLAUDE.md` (names module, program lock rule) and verify it stays under 40 lines.
- [x] 4.9 Implement `skipWorkout` (D15): one SKIPPED session with the client-minted id (`ON CONFLICT (id) DO NOTHING`, re-read through `userScope`, a mismatch is `conflict`), refused when the workout already has any session, then the finish's roll-over under the program lock. Add its request and response to `packages/shared`. Verify with Neon tests: one row and nothing else, what's next moves on; a replay writes nothing; skipping the last workout extends an open-ended program and completes a fixed one; a started or resolved workout is refused by name; a skip racing a start, and a skip and a finish resolving the last two workouts, forced with an open transaction holding the lock.

## 5. API routes (`apps/api`)

- [x] 5.1 Add the exercise and program routes from D7, D10 and D11, and `POST /api/workouts/:id/skip` (D15). Writes mount `requirePro`; reads mount only `requireAuth`. Verify route tests through `createApp` with fakes: each route maps results and `ServiceError` kinds to 200/201/204/400/403/404/409, and every write returns 403 with `requirePro({ bypass: false })` for a lapsed `subStatus`.

## 6. Docs

- [x] 6.1 In `operations.md`: §3.7 gets the trained-workout freeze (D5); §3.8 gets the fingerprint's exact normalization (group renumbering) and the save-time recheck (D7); §2 gets edit and reactivate for custom exercises; §3.12 says extend is idempotent on the new plan id. Verify each section links the code that implements it.

## 7. Landing page (`apps/web`, after 1.1; Impeccable and `emil-design-eng` loaded)

- [x] 7.1 Split `main.tsx` into a bootstrap, a landing chunk and an app chunk (D2). Mount Clerk sign-in and sign-up at `/sign-in` and `/sign-up`, and add the idle-time session check. Verify Playwright: a fresh context at `/` shows the landing page and has not requested the app chunk before first paint; a context with a last-user record goes straight to home; "Get started" reaches sign-up and "Log in" reaches sign-in; `offline.preview.ts` still passes on the split build.
- [x] 7.2 Build the landing page to the approved brief, using the design-system tokens, light and dark, at phone width with no horizontal scroll, including KanjiVG attribution. Verify Playwright at 375px and 1280px in both themes. Run Impeccable's detector and finish review; the result must be ship, or its fixes applied.
- [x] 7.3 Serve the landing page at `/about` for everyone (D2 amendment): the bootstrap's landing branch for `/about` whatever the device record, a session never swapping it for home; an `/about` route outside `AuthGate` in the app; "About Tanren" in the account menu; signed in (the record, or Clerk's session behind the page), every sign-up call to action reads "Open app" and goes home, and "Log in" hides. Verify: unit tests for the landing page signed in and for the shell at `/about`; Playwright (`landing.preview.ts`): `/about` signed out paints without the app chunk with "Log in"; signed in, the account menu opens `/about` with "Open app", which goes home; a hard load of `/about` with a record paints "Open app" without the app chunk or Clerk. Screenshots at 390px and 1280px; Impeccable's detector on the changed UI.
- [x] 7.4 Install updates when it is safe (D18, amends step 3's D13): one registration in the bootstrap (`boot/updates.ts`), `updatePolicy` (`now` on public pages, `at-safe-moment` signed in with no workout in progress, `prompt` mid-workout), builder drafts flushed and held before a reload, no reload with a dialog open, a field focused or a plan-side write in flight. Verify: unit tests for `updatePolicy`, the controller (over a fake `registerSW`), the app's context and safe moves, the registration through a mocked `virtual:pwa-register`, and the queue resending a write that was on the wire at a reload; Playwright (`update.preview.ts`, build A then build B from a switchable static server): signed out, B arrives with no prompt; signed in with nothing in progress, B waits on home and arrives on the next screen with no prompt; mid-workout, only the prompt, no reload on a screen change, and Reload offline keeps the queued set, which syncs after.

## 8. Signed-in home and catalog (`apps/web`, after 1.2 and 1.3)

- [x] 8.1 Rework home and add the Programs screen per the brief (`apps-web-src-home`): continue cards first, then next cards with Skip (a queued write, D15) and Finish & start next. Programs screen: status groups, progress, activate, archive, copy (with rename in the flow), rename, and extend for fixed programs. "Create from scratch" opens the builder. Verify Playwright against the fake API for each `specs/program-lifecycle` scenario, the `program-templates` "Create from scratch" scenario, and the skip and Finish & start next scenarios in `specs/workout-sessions`, including skipping offline.
- [x] 8.2 Add the exercise picker and the catalog screen: filters, create custom with metrics, edit own, setup and cues, retire and reactivate. Verify Playwright for each `specs/exercise-catalog` scenario.

## 9. Builder (`apps/web`, after 1.3)

- [x] 9.1 Build the cycle editor to the brief: workouts, slots (exercise or placeholder), target sets, per-set prescriptions, supersets with derived A1/A2 labels, trained workouts shown frozen, and an IndexedDB draft (D14). Verify Playwright: create a 12-cycle program from scratch; reload mid-build and the draft is restored; trained workouts can't be moved or edited.
- [x] 9.2 Build the apply-to-cycles confirmation from the preview (D7): pre-checks, the "looks intentionally different" annotation, locked trained cycles, and a stale refusal that tells the user to reload. Verify Playwright for each apply scenario in `specs/program-builder`.
- [x] 9.3 Add the logger stopgap (D12): "logging arrives soon" rows with Skip for placeholders and slots that aren't weight and reps. Verify Playwright: a workout containing a placeholder and Plank can be finished, and neither accepts a set.
- [x] 9.4 Run Impeccable's detector and finish review on home, the catalog and the builder. Verify the result is ship, or its fixes are applied. Then update `apps/web/DESIGN.md` and `apps/web/CLAUDE.md` for the new surfaces and hooks.

## 10. Verification

- [x] 10.1 Run `npm run typecheck`, `npm run lint` and `npm test` from the repo root (the `packages/db` and `packages/services` suites run against a real Neon branch). Verify all exit 0.
- [x] 10.2 Run `npm run test:e2e -w @workout-tracker/web`, including the offline preview test on the split build. Verify all pass.
- [ ] 10.3 After the user deploys: on tanrenstrength.com, signed out, the landing page appears first. Signed in, create a fixed program from scratch, edit cycle 2 and apply it to later cycles with one cycle deliberately different, activate the program, and log one of its workouts. Record the result in the PR.
- [x] 10.4 Run the `verify-done` skill and report any clause that is not satisfied.

## Workflow follow-up

- Correct the artifacts to what was actually built, then `/opsx:archive`.
- Next, by the user's plan (memory `step-4-plan`): the user-led design pass on the workout screen, before 4b.
