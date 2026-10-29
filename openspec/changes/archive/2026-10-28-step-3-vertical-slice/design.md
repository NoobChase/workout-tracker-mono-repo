# Design

## Context

The motivation is in `proposal.md` (Why) and the behavior in `specs/`. The
operations are `docs/operations.md` §0.2, §3.1, §3.10, §3.12, §4.1–4.13, §4.15 and §4.16,
the schema is `docs/data-model.md` §3.6, and the offline architecture is in the
build plan, step 3. This document records only the decisions those leave open.

Current state:
- **Database:** the plan tables exist; the session tables don't.
  `packages/db/src/scope.ts` covers the plan side (`userScope`, `assertOwned`,
  `assertExercisesUsable`).
- **`apps/api`:** routes for `/hello`, `/me` and webhooks only.
  `requirePro(bypass)` exists and always passes.
- **`apps/web`:** the design system and a dev kit, with no router and no data
  layer.
- **`infra`:** a CloudFront viewer function already rewrites client routes to
  `/index.html`. The site deploys with `BucketDeployment`, which sets no
  `Cache-Control`.

## Goals / Non-Goals

**Goals:**
- Prove the offline path end to end on the deployed site, against a real Neon
  database.
- Make every service function callable from step 6's MCP server unchanged.

**Non-Goals:**
- A general sync engine, or offline reads beyond the in-progress and next
  workouts.
- A batch sync endpoint.
- Optimizing the clone for large programs.

## Decisions

### D1. The service layer is its own workspace, `packages/services`
Functions take `(db, user, input)` and return plain data or a typed error. They
don't touch HTTP. `apps/api` routes and, in step 6, `apps/mcp` tools both import
them.
*Rejected:* services inside `apps/api`. The MCP server would have to import
from a sibling app, which the build plan already rules out for the database
(the reason `packages/db` exists).

### D2. Templates are code-owned data, materialized per user on start
`packages/db/src/templates.ts` holds the templates the way `catalog.ts` holds
exercises: a frozen slug per template, exercises referenced by their frozen
catalog ids, and target sets and rep ranges with no weights. Starting a
template runs the ordinary create-program transaction (§3.1) with
`target_cycles = NULL`, then activates it (§3.10). A test checks every
template against the catalog, per the program-templates spec.
Initial set (test content for now; the user will rework it before
production):
- Push Pull Legs (3 workouts)
- Full Body 3-Day (A/B/C)
- Upper Lower 4-Day

*Rejected:*
- **Template programs stored as rows under a system user, cloned on start.**
  That would create cross-user plan rows, which `data-model.md` §2.2 ("nothing
  is shared between programs") and the scoping helper are built to forbid.
- **A per-user seed.** Users appear at runtime, and seeds run in CI.

### D3. The clone primitive is written once, generic, in `packages/db`
`clonePlan(tx, user, { sourcePlanId, target })` copies workouts, planned
exercises and planned sets in one pass per level, minting UUIDv7s as it walks
(§0.2). It is used here only by extension (§3.12), but it is built and tested
for all three callers, so step 4 only adds callers. It is tested on a real Neon
branch, as root `CLAUDE.md` requires.
*Rejected:* an extension-only copy. Step 4 would then write the real one and
leave two.

### D4. Finishing is idempotent by guarding the status transition
`finishWorkout` runs this:

```sql
UPDATE workout_sessions SET status = 'COMPLETED'
WHERE <scoped> AND id = $id AND status = 'IN_PROGRESS'
```

The exhaustion check and the extension run only when that update changed a
row. A replayed finish changes nothing, so it adds no second cycle. The row
lock serializes two concurrent deliveries. Before the exhaustion check,
`finishWorkout` also locks the program row (`FOR UPDATE`). Otherwise two
sessions finishing the last two workouts at the same moment would each miss
the other's uncommitted finish, and neither would extend the program. A
forced-interleaving test covers this case.
*Rejected:* deterministic clone ids derived from the session id. That is more
machinery for the same guarantee.

### D5. One endpoint per offline operation; logging carries its parent
| Operation | Endpoint |
|---|---|
| Start | `PUT /sessions/:id` |
| Log a set | `PUT /sets/:id` |
| Edit a set | `PATCH /sets/:id` |
| Delete a set | `DELETE /sets/:id` |
| Finish | `POST /sessions/:id/finish` |

- **Log a set** includes the session-exercise fields (`id`,
  `plannedExerciseId`, `exerciseId`, `position`). The server upserts that row
  (`ON CONFLICT (id) DO NOTHING`) and inserts the set in one transaction, so
  §4.3's first-contact pair is one request.
- **Timestamps come from the device.** Start sends `performedAt` and logging
  sends `loggedAt`, both captured when the lifter acted. Otherwise a session
  replayed hours later would be stamped with the time it synced. The column
  defaults only apply to writes that don't send a time.
- **Edit** sends absolute values, so a replay is harmless.
- **Delete** removes the set, renumbers the survivors, and removes an emptied
  session exercise, all in one transaction. Deleting a missing id succeeds.

*Rejected:*
- **A batch `/sync` endpoint that takes the whole queue.** It makes partial
  failure and rejection reporting harder, and the spec demands serial delivery
  anyway.
- **Server-assigned `set_number`.** Strict ordering already makes the client's
  number correct. Sending it keeps the screen and the server identical, and a
  clash (`409`) is a visible rejection rather than silent drift.

### D6. Deleting a session exercise's last set removes its row
That keeps "skipped = no session_exercises row" (§4.7) true after an undo.
`docs/operations.md` doesn't say this, so this change adds it there.
*Rejected:* leaving an empty session exercise. It would read as "performed
with zero sets", which no query expects.

### D7. A hand-written IndexedDB queue with one lane per session
The queue lives in an `idb` store keyed by a monotonically increasing sequence
number. Each item is a validated wire request (method, path, body), built from
`packages/shared` schemas, and carries its session id. Each session is a lane,
drained serially in sequence order. A held or rejected head stops only its own
lane; other sessions' lanes keep flowing.
*Revised 2026-10-27 after code review:* the first build used one global FIFO.
That let a held write (another account's, on a shared device) or a single
rejected write block every later session, which broke the offline-logging
spec's per-session rule.

One flusher runs at a time (Web Locks, across tabs), with one request in
flight overall: the lowest-sequence head of any lane that is ready. Each send
times out after 20s, so a hung request can't block every lane.

Each response falls into one of three classes:

| Response | Class | Effect |
|---|---|---|
| no signal, `clerk_offline`, network error, request timeout (20s), `5xx`, `408`, `429`, Clerk not yet loaded | retry | this lane backs off from 1s, doubling, capped at 30s; other lanes keep flowing |
| any `4xx` without the API's `{ ok: false, error }` body (CloudFront or the edge, e.g. an origin-secret rotation) | retry | as above: not a verdict on the write |
| `401` | refresh | refresh the Clerk token (`skipCache`), then resend once at once; tokens expire while offline. A second `401` is a retry |
| the API's own `4xx` (`400`, `402`, `403`, `404`, `409`, `422`) | rejected | stop this session's lane at the item, keep it, and show the reason |

A flush trigger (enqueue, the `online` event, app start, Clerk loading)
retries every backing-off lane at once, including one whose send fails while
the trigger arrives; the backoff timer releases only the lanes that are due.

*Rejected:* TanStack Query's persisted mutations. The build plan explains why:
they don't guarantee serial order or survive a reload without
hydration-time defaults.

### D8. The in-progress workout's local record is what the logger renders
Each in-progress session has an IndexedDB record holding:
- the prefetched context (D9);
- the sets as the lifter sees them, each with a sync state derived from the
  queue.

The logger reads only this record, so it behaves the same online and offline.
History and what's next are server reads through TanStack Query and are online
only, as `data-model.md` §2.11 intends. The record is dropped once the session
is finished and fully acknowledged.
*Rejected:* deriving the logger from the TanStack cache plus optimistic
updates. Its state would then live in two places that must reconcile after a
reload.

### D9. Prefetch is one context read per next workout
`GET /workouts/:id/context` returns:
- the planned exercises and planned sets;
- the referenced exercises with their metrics;
- the user's unit settings;
- the last COMPLETED session's sets for each exercise, from any workout.

Home loads what's next and then each workout's context, and caches them. That
makes an offline start possible, per the offline-logging spec.
*Rejected:* prefetching only at the moment of starting. A start in a basement
would then have no plan.

### D10. Clerk must not gate the offline path
`ClerkProvider` loads `clerk-js` from Clerk's frontend API, which fails with no
network. The plan:
- Bundle `clerk-js` instead.
- Render the logger and home from local data whenever a previous sign-in is
  recorded on the device, even if Clerk hasn't loaded.
- Ask Clerk for a token only when flushing.

**Spike result (task 1.1): both halves are required.**
- **Clerk loaded from its servers (the old setup):** it never loads offline,
  and it stays in `error` after the signal returns until a reload.
- **Bundled** (`<ClerkProvider Clerk={Clerk} ui={ui}>` with `@clerk/clerk-js`
  and `@clerk/ui`): it reaches `isLoaded` in a `degraded` state after about
  14s offline. Meanwhile the shell and the IndexedDB data render in about
  200ms. So the app renders from local data and never waits for Clerk.

Rules the build follows:
- **Recording the user:** write the "last signed-in user" record only when
  `clerk.status === "ready"`. In `degraded` mode the signed-in state comes
  from an unverified cookie.
- **The flusher:**
  - It never calls `getToken()` while `navigator.onLine` is false.
  - It treats a `clerk_offline` error as a retry (D7).
  - It must not go through an `apiFetch` that waits for Clerk to load.
- **Recovery:** after an offline cold start, Clerk stays `degraded` even once
  the signal returns, but `getToken({ skipCache: true })` returns a fresh
  token anyway (about 1.6s, verified with a real session). The flusher
  therefore needs no reload. Nothing in the UI may branch on `degraded`, and
  the next ordinary online load returns Clerk to `ready`.
- **Cookies:** clerk-js never cleared the session cookie while offline, even
  with its token expired.
- **Service worker:** `maximumFileSizeToCacheInBytes` is 8 MiB.
- **Size cost:** the entry chunk grows from 118 KB to 708 KB gzipped. It is
  precached after the first visit, and Clerk was already fetched at runtime
  before.
- `@clerk/clerk-js/no-rhc` is not usable: it drops the CAPTCHA that sign-up
  needs.

Verified with a real dev-instance account: a signed-in offline reload, token
expiry while offline, and recovery once online. Still unproven:
- iOS Safari and the installed PWA (task 10.3 covers this on a phone);
- the production instance's first-party cookies;
- offline periods long enough for the Clerk session itself to end.

*Rejected:* requiring Clerk to load before rendering anything. Offline cold
starts would fail.

### D11. `requirePro` goes on every new mutating route now
This follows `data-model.md` §3.8, and route tests run it with
`bypass: false`. `apps/api/CLAUDE.md` and the `requirePro` doc comment are
corrected to match.
*Rejected:* waiting for step 5, which would mean retrofitting every write route
later (build plan step 2).

### D12. The client and the server mint ids with one shared helper
`packages/shared` exports `newId()` (`uuid` v7, already a dependency of
`packages/db`).

### D13. Routing and the service worker
- **Router:** React Router (library mode) for four screens: home, workout,
  history, and session detail.
- **Service worker:** `vite-plugin-pwa` with `generateSW`. It precaches the
  build and falls back to `/index.html` for navigation, excluding `/api/*`.
- **Kit:** `/design` stays dev-only, outside the router.

*Rejected:* TanStack Router. Its type safety doesn't buy much for four routes.

### D14. `sw.js` and `index.html` are never cached by browsers
A second `BucketDeployment` (or a response-headers policy) serves those two
files with `Cache-Control: no-cache`, so a deploy reaches installed clients.
Hashed assets keep long caching. The change is in `infra`; the user runs the
deploy.

## Risks / Trade-offs

- **[Clerk offline cold start (D10)]** → The spike runs first. A fallback is
  defined, and the Playwright offline test proves whichever one ships.
- **[A rejected queue item blocks later sets]** → This is deliberate (the
  offline-logging spec). The rejection shows its reason. Discard-and-continue
  is left for later, because the server's reason (validation, ownership) means
  later writes depend on the rejected one.
  **Known gap, deferred to step 5 (user decision, 2026-10-27).** Editing a
  rejected set queues a `PATCH` behind the refused `PUT`, so it cannot make that
  set go through. The only recovery in step 3 is "Try again" once the cause
  clears, typically a renewed subscription. Step 5, when lapses become real,
  decides between rewriting the rejected write on edit and discarding it.
- **[A stuck lane]** → A rejected or held write stops only its own session's
  lane (D7), so other workouts on the device still sync.
- **[Stale service worker after deploy]** → D14, plus `registerType: prompt`,
  so a new version waits for the lifter instead of reloading mid-set.
- **[The clone has only one caller in step 3]** → Integration tests cover all
  three source and target shapes now, so step 4 doesn't discover bugs late.
- **[Template content is authored by an agent]** → It is test content for now;
  the user will rework the templates before a production release.

## Migration Plan

1. The `packages/db` schema change and the generated migration `0004`. CI
   migrates `dev`, then `production`, as today. The tables are new, so
   nothing needs a backfill.
2. Deploy order is the usual one. The user runs `npm run deploy` after
   reviewing the `cdk diff` (D14).
3. Rollback: the web and API roll back by redeploying the previous commit. The
   new tables are additive and can stay.
