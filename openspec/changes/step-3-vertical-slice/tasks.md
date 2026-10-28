# Tasks

## 1. Spike: offline cold start with Clerk (design D10)

- [x] 1.1 In a throwaway branch of `apps/web`, bundle `clerk-js` and add a minimal `vite-plugin-pwa` service worker. Verify with Playwright: sign in, go offline, reload; the app renders a page that reads the last signed-in user from IndexedDB. Record which approach works (bundled, or the D10 fallback) in `design.md` D10 before starting group 7.

## 2. Schema and shared database helpers (`packages/db`)

- [x] 2.1 Add `workout_sessions`, `session_exercises` and `session_sets` to `src/schema.ts` per `docs/data-model.md` §3.6. Make the set-number unique `DEFERRABLE` via a `--custom` migration, as `0001` did. Generate `0004` with `npx drizzle-kit generate --name session_tables`. Verify `test/schema.test.ts` covers the generated `weight_kg` (no `ELSE`), the deferrable unique, and the `num_nonnulls` check.
- [x] 2.2 Delete the §3.6 DDL block from `docs/data-model.md`, keeping its reasoning prose and pointing at `schema.ts`. Verify that `grep -n "CREATE TABLE workout_sessions" docs/` finds nothing.
- [x] 2.3 Extend `userScope`, `OwnedTable` and `assertOwned` to the three session tables. Verify with new cases in `test/scope.test.ts` that another user's sessions, session exercises and sets are unreadable and unwritable.
- [x] 2.4 Add the "a set that counts" predicate helper, and verify a test where warm-ups and drop children are excluded from a count.
- [x] 2.5 Implement `clonePlan` (D3). Verify on a Neon branch with integration tests for all three caller shapes: new cycle in the same program, cycle 1 into a new program, and an edited cycle over later cycles. Each test checks that every level is copied, ids are fresh, positions and set numbers are preserved, and a rerun with the same ids is a no-op.
- [x] 2.6 Add `src/templates.ts` (D2) with Push Pull Legs, Full Body 3-Day and Upper Lower 4-Day. Verify with a test that every exercise id is standard, active, and declares weight and reps metrics, with no placeholders. Contents are placeholders for testing; the user waived review until closer to production.
- [x] 2.7 Update `packages/db/CLAUDE.md` for the session tables, the predicate, `clonePlan` and the templates, and verify every file it names exists.

## 3. Shared contracts (`packages/shared`)

- [x] 3.1 Add `newId()` (UUIDv7, D12) and Zod schemas for every request and response in D5 and D9: templates, start from template, what's next, workout context, start, log, edit, delete, finish, history page, session detail. Verify unit tests that round-trip valid payloads and reject the invalid ones the specs name (missing unit with weight, negative reps, non-v7 ids).

## 4. Service layer (`packages/services`, new workspace)

- [x] 4.1 Scaffold the workspace (typecheck, lint, a test script on a Neon branch like `packages/db`). Verify `npm run typecheck` and `npm test -w @workout-tracker/services` run green on an empty suite.
- [x] 4.2 Implement `listTemplates` and `startProgramFromTemplate`: one transaction, open-ended, ACTIVE, name suffixing, idempotent on the client id. Verify with Neon integration tests for each scenario in `specs/program-templates`.
- [x] 4.3 Implement `whatsNext` (data-model §5) and `getWorkoutContext` (D9, including last-completed-session numbers). Verify with Neon integration tests for each what's-next scenario, the abandoned-session case, and a cross-user case.
- [x] 4.4 Implement `startWorkout`, `logSet` (session-exercise upsert plus the set, client unit plus the server `COALESCE` fallback), `editSet` and `deleteSet` (renumber, and remove an emptied session exercise, D6). Verify with Neon integration tests for each scenario in `specs/workout-sessions`. Include replaying every write with the same ids, which must be a no-op. Check deferred-constraint behavior under `SET CONSTRAINTS ALL IMMEDIATE`.
- [x] 4.5 Implement `finishWorkout` (D4: guarded transition, exhaustion check, open-ended extension through `clonePlan`). Verify with Neon integration tests: mid-cycle finish, last-workout extension, a double delivery creating one cycle, and two concurrent finishes forced to interleave with an open transaction, as `test/users.test.ts` does.
- [x] 4.6 Implement `getWorkoutHistory` (paged, counts through the predicate) and `getSession` (skipped exercises shown). Verify with Neon integration tests for each scenario in `specs/workout-history`.
- [x] 4.7 Add a `packages/services/CLAUDE.md` (function shape, error type, no HTTP), and verify it is under 40 lines and accurate.

## 5. API routes (`apps/api`)

- [x] 5.1 Add thin routes for D5 and D9 plus the template, history and session reads. Writes mount `requirePro`; reads mount only `requireAuth`. Verify with route tests through `createApp` with fakes: each route maps service results and typed errors to the right status (200/201/204, 400, 403, 404, 409), and writes return 403 with `requirePro({ bypass: false })` for a lapsed `subStatus`.
- [x] 5.2 Fix `apps/api/CLAUDE.md` (writes now carry `requirePro`) and the stale `requirePro` doc comment in `src/auth.ts`. Verify that `grep -n "nothing else" apps/api/src/auth.ts` is empty.

## 6. Docs (`docs/operations.md`)

- [x] 6.1 Add operations for editing a logged set and deleting a logged set: rows written, the one-transaction renumber, removing an emptied session exercise, and idempotency. Verify they are linked from §0.3's offline table.

## 7. Web data layer (`apps/web`)

- [x] 7.1 Add React Router (D13), TanStack Query, `idb` and `vite-plugin-pwa` (`registerType: prompt`, navigation fallback excluding `/api/*`), plus the approach chosen in task 1.1. Verify `npm run build -w @workout-tracker/web` emits `sw.js`, and the dist grep still shows the `/design` kit absent.
- [x] 7.2 Implement the IndexedDB mutation queue (D7): FIFO by sequence, serial flush, retry, refresh and reject classes, backoff capped at 30s, and survival across reloads. Verify Vitest tests with a fake API for ordering, overtaking prevention, `401` refresh, `5xx` retry, and stop-on-reject.
- [x] 7.3 Implement the local session record (D8) and prefetch (D9), with client-side unit resolution. Verify Vitest tests that a queued edit or delete updates the record and its sync states, and that the unit resolves override-first.

## 8. Web screens (`apps/web`, design system, `emil-design-eng` and Impeccable loaded)

- [x] 8.1 Home: what's next per program, resume banner for an IN_PROGRESS session, the template list with "Create from scratch" (announces the builder, writes nothing), and an always-visible sync status. Verify Playwright: a fresh account sees templates; after a start it sees the program's first workout.
- [x] 8.2 Workout screen: plan beside last-time numbers, steppers seeded from last time, Log set, edit and delete a set, skip an exercise, finish. Built from `SetRow`, `NumberStepper` and `SetFigures`. Verify Playwright for the workout-sessions scenarios through the UI, including stopping short and an extra set.
- [x] 8.3 History list (paged) and session detail (skipped exercises shown). Verify Playwright: a finished session appears with the right counted sets and units.
- [x] 8.4 Run Impeccable's detector on the new screens, then a finish review and a design-system extension check against `apps/web/DESIGN.md`. Verify the reviewer returns ship, or its fixes are applied and scored.

## 9. Infra (`infra`)

- [x] 9.1 Serve `sw.js` and `index.html` with `Cache-Control: no-cache` (D14). Verify the infra tests pin the header and `cdk diff` shows only that change. Hand the diff to the user; do not deploy.

## 10. Verification

- [x] 10.1 Run `npm run typecheck`, `npm run lint` and `npm test` from the repo root (the `packages/db` and `packages/services` suites run against a real Neon branch). Verify all exit 0.
- [x] 10.2 Run `npm run test:e2e -w @workout-tracker/web`, including an offline test: sign in, start a workout, `context.setOffline(true)`, log sets, delete one, finish, reload while offline, go online. Verify that history shows the session with the right sets and that the server received the writes in order.
- [ ] 10.3 After the user deploys, run the build plan's step 3 goal on the real site from a phone: airplane mode on, start, log, finish, airplane mode off, then history. Record the result in the PR.
- [x] 10.4 Run the `verify-done` skill and report any clause that is not satisfied.

## Workflow follow-up

- Correct the artifacts to what was actually built, then `/opsx:archive` in the PR that ships step 3.
