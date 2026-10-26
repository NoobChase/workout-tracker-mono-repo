# Proposal

## Why

Build step 3 (`docs/workout-tracker-build-plan.md`, "Step 3 — Vertical slice") is
the point where the app first does its job: start a workout, log a set with
airplane mode on, and see it in history once signal returns. Until it ships,
nothing proves the offline write path, the service layer, or the design system
(`apps/web/DESIGN.md`) against real use. Step 4's program builder isn't built
yet, so users start from **default templates**. That gives every user a real,
plan-driven workout on day one.

## What Changes

- **Session schema.** Add `workout_sessions`, `session_exercises` and
  `session_sets` to `packages/db/src/schema.ts` (`docs/data-model.md` §3.6),
  with their conditions in `userScope`, and a generated migration. Remove the
  §3.6 DDL from `data-model.md`, as that section instructs.
- **The shared "set that counts" predicate** in `packages/db`
  (root `CLAUDE.md`). Nothing calls it yet beyond history counts; it exists
  before the first query that would otherwise inline it.
- **Starter templates.** A small set of default programs, stored as data the
  way the exercise catalog is. "Start from a template" runs the real
  create-program operation (`operations.md` §3.1) for an **open-ended** program
  and activates it (§3.10). "Create from scratch" is a visible entry point that
  says the program builder is coming.
- **The clone primitive** (`operations.md` §0.2), built once, used here only by
  §3.12. When an open-ended program runs out of materialized cycles,
  finishing its last workout extends it (§4.13).
- **Service layer** (HTTP-agnostic, in a new `packages/services` workspace so
  step 6's MCP server can import it without reaching into a sibling app): `listTemplates`,
  `startProgramFromTemplate`, `whatsNext` (§4.1), `getSessionContext` (the
  prefetch), `startWorkout` (§4.2), `logSet` (§4.3–4.4), `editSet`,
  `deleteSet` (renumbering survivors in one transaction, `data-model.md` §8.2),
  `finishWorkout` (§4.13), `getWorkoutHistory`, `getSession`. Thin Hono routes
  adapt them. Zod contracts live in `packages/shared`.
- **Entitlement on writes.** Every new mutating route mounts `requirePro`. It
  is still hardcoded-entitled until step 5, per `data-model.md` §3.8.
- **Offline logging** (build plan step 3, "The offline architecture"):
  - a `vite-plugin-pwa` service worker;
  - an explicit IndexedDB mutation queue, flushed strictly in order and
    serially per session;
  - client-minted UUIDv7 ids;
  - prefetch at session start;
  - client-side unit resolution.
- **UI** in the committed design system:
  - a home that lists "what's next" per active program, plus templates when
    there are none;
  - the logger, with the prescribed set, steppers, Log set, edit/delete, skip
    exercise and finish;
  - resume for an unfinished workout;
  - history: a session list and a session detail page;
  - a sync status that is always visible.
- **Doc fixes:**
  - `operations.md` gains entries for editing and deleting a logged set (the
    four offline operations name them, but §4 has no section for them).
  - `apps/api/CLAUDE.md`'s note that writes get `requirePro` only in step 5 is
    corrected.

## Capabilities

### New Capabilities

- `program-templates`: the default programs a user can start from, and what
  starting one creates.
- `workout-sessions`: training a workout: what's next, start, log, edit and
  delete sets, skip an exercise, resume, and finish (including open-ended
  extension).
- `offline-logging`: how session writes survive having no signal. Covers
  app-shell caching, the ordered durable queue, client-minted ids, idempotent
  replay, prefetch, unit resolution, and the sync state shown to the lifter.
- `workout-history`: reviewing completed sessions and their sets.

### Modified Capabilities

None. There are no living specs yet; steps 1–2 predate OpenSpec.

## Out of scope

- **The program builder and the clone's other two callers** (§3.1–3.9, §3.11).
  They are step 4. "Create from scratch" is only an entry point here. The
  clone primitive is built in full, but only the extension path calls it.
- **Mid-workout deviations:** substitute (§4.5), placeholders (§4.6),
  unplanned exercises (§4.8), drop sets (§4.11), timed or bodyweight sets
  (§4.12), and skipping a whole workout (§4.14). The user chose the core loop
  for step 3. Templates therefore contain only weighted, rep-based exercises
  with no placeholders, so nothing a template prescribes needs a deferred
  operation.
- **Ad-hoc ("empty") workouts.** The schema allows `workout_id NULL`, but the
  user chose templates now and the builder in step 4.
- **Unit settings screens** (§1.2, §1.3). The client resolves units from
  whatever is stored; new users get the column default.
- **Lapsed read-only UI and billing** (step 5). `requirePro` is mounted but
  always passes.
- **Analytics, progression and export** (§5.2–5.4). Step 4 and later.
- **Discarding an unfinished workout.** `operations.md` has no such operation,
  and `data-model.md` §3.6's "resume or discard?" names no write. Step 3 offers
  only resume. Discard needs its own operation decided first.
- **Multi-device sync, conflict resolution, tombstones, `updated_at`.**
  Deliberately not built (`data-model.md` §2.11).

## Impact

- **`packages/db`:** the schema, migration `0004`, `scope.ts`, the predicate
  helper, the clone, the templates data, and integration tests on a Neon
  branch.
- **`packages/shared`:** Zod contracts for every new route and queued
  mutation.
- **`packages/services`** (new): the service functions and their tests.
- **`apps/api`:** routes, which are thin adapters over the services, and
  route tests.
- **`apps/web`:**
  - routing (the first real screens, so a router arrives);
  - `vite-plugin-pwa`, the IndexedDB queue and TanStack Query;
  - the screens, plus unit and Playwright tests.
- **`infra`:** a CloudFront check only. The existing viewer function already
  rewrites client routes to `/index.html`. The service worker must not be
  cached stale, so `sw.js` and `index.html` may need no-cache headers on
  upload. The `cdk diff` goes to the user; nothing is deployed by an agent.
- **New dependencies:**
  - `vite-plugin-pwa`
  - `idb` (or equivalent)
  - `@tanstack/react-query`
  - a router
  - a UUIDv7 generator shared by the client and the server
