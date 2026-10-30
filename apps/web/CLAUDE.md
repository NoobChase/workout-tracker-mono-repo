# apps/web

React + Vite + Tailwind v4 PWA. Root `CLAUDE.md` rules apply; these are the
package conventions.

## Design system

- **Tokens live in `src/index.css`.** Each color is written once as a
  light/dark pair, `var(--if-light, …) var(--if-dark, …)`; the two space
  toggles stand in for `light-dark()` so Safari before 17.5 still works. They
  are mapped onto shadcn/ui's names (`--background`, `--primary`, `--ring`, …)
  and exposed to Tailwind through `@theme inline`. No raw hex in components.
  One exception, because it must work before any CSS loads: the two `--bg`
  values also appear in `index.html`, in the two `theme-color` meta tags and
  the pre-paint script. Change `--bg` and you change those three spots
  together. `src/ui/theme.ts` reads the computed background, so it never
  holds a copy.
- **Copper is for the primary action and the live set only.** Text on
  `--ghost` must be `--text` (faint and copper fail AA on it). Control
  boundaries use `--edge` (3:1), hairlines use `--line` / `--line-2`.
  Re-check contrast numerically when a token changes; the ratios are noted
  above the tokens.
- **Theme**: follows `prefers-color-scheme`; `ThemeToggle` pins
  `<html data-theme>` and stores it in `localStorage['tanren-theme']`
  (`src/ui/theme.ts`, every storage access in try/catch). A toggle that lands
  on the device's own scheme clears the key, so the device is in control
  again. The inline script in `index.html` applies a stored theme before
  first paint; keep the key and the `tanren-theme-color` meta id in sync. Any
  element can pin its own theme with `data-theme`. If a CSP is ever added,
  that inline script needs its hash.
- **Fonts are self-hosted** from `@fontsource` (offline PWA, never Google
  Fonts): Albert Sans for UI, Geist Mono (`num` utility, tabular) for every
  weight, rep and time. Shippori Mincho B1 is only the two kanji 鍛錬 on the
  landing page (never the wordmark, which is "TANREN" alone), shipped as the
  two Fontsource subset files that contain them.
- **Primitives live in `src/ui/`**, shadcn/ui-style (`components.json`, `cn`
  in `src/lib/utils.ts`, `@/` = `src/`). Restyle shadcn components into the
  world when adding them; never ship one stock. `Button loading` ignores
  every activation (an `onClick` guard, keyboard included) but stays
  enabled, so focus and its ring stay put. `NumberField` is a
  `spinbutton` (value, range, unit as `aria-valuetext`).
- **Targets**: anything a lifter taps mid-workout is at least 44px (logging
  controls 56px: `Button size="log"`, `NumberStepper`). `Button size="sm"`
  (36px) is for planning and settings screens only, never an in-workout
  control. Nothing anywhere is under 24px.
- **A set line has one grammar**: mono for numerals only (`SetFigures`: weight,
  small unit, ×, reps), words in Albert Sans (`SetStatusText`). Build any
  list of sets from those pieces, cards included. A number not entered yet
  is `BlankFigure` (a ruled blank, never a dash: a dash reads as minus).
  `SetRow` states: planned, live, logged, queued, failed, rejected (with the
  server's `reason` on the line); `onPress` makes the line one button to
  edit, named in full ("Set 2, 225 lb for 5 reps, logged. Edit").
  `SyncStatus` counts sets; a start or finish alone reads "Workout …"; it
  adds `rejected` (danger: "A set was rejected, its workout stopped
  syncing"; lanes are per workout) and `held` (muted, waiting, not wrong).
- **Motion**: `ease-out` is the `cubic-bezier(0.23, 1, 0.32, 1)` token;
  pressables scale to .97 on press. The one exception is `NumberStepper`'s
  − and +: they share the field's hairlines, so their icon scales to .85
  instead of the button. Overlays use keyframes (Radix waits for them).
  The one authored moment is `SetRow` ruling a logged set into place, ≤240ms.
  Nothing moves under `prefers-reduced-motion`.

## Kit

`/design` is the design kit (`src/design/`): every primitive in every state,
both themes. It is **development only**, gated on `import.meta.env.DEV` in
`main.tsx` and mounted outside the router, so it is absent from the
production bundle (grep `dist/` for "Tanren design kit" to check). Its
numbers are demo data and say so.

## Bootstrap and chunks (design D2)

- **`main.tsx` is the bootstrap**: React, the tokens, the service worker's
  one registration (`updates.start()`, below) and one IndexedDB read
  (`boot/last-user-hint.ts`, the data layer's `meta.lastUser`, connection
  closed at once). Path `/` with no record, and `/about` always: the
  **landing chunk** (`src/landing/`, no Clerk, no data layer, never import
  `data/` or `@clerk` there; at `/about` the record is its `signedIn`, so
  every sign-up call to action reads "Open app", home, and "Log in" hides).
  Anything else: the **app chunk** (`app/app-root.tsx`: Clerk, the data
  layer, the router). The kit branch (`/design`, dev only) sits before
  both.
- **`boot/shell.tsx`** shows the landing page and, after the stroke intro
  (3.5s) and idle time, loads the app chunk behind it; its `AppRoot`
  (`active: false`) only asks Clerk for a session and swaps to the app if one
  exists (at `/about` (`about`), a session only turns the calls to action to
  "Open app"; the page stays). A call to action (`onEnter`) pushes
  `/sign-in`, `/sign-up` or `/` and shows the app once its chunk is here.
  `AppRoot` is always the second child, so its one `ClerkProvider` survives
  the handover.
- **Updates** (`boot/updates.ts`, step 4a D18): the bootstrap registers the
  worker once for both chunks (`virtual:pwa-register`, `registerType:
  "prompt"`); `updatePolicy(context)` decides: `now` on a public page
  (landing, `/about`, sign-in and sign-up, nobody signed in),
  `at-safe-moment` signed in with no `IN_PROGRESS` session record on the
  device (the next route change, or the page hidden or shown), `prompt`
  mid-workout (the toast). Never while `pageIsBusy` (a dialog open, a text
  field focused) or a plan-side mutation is in flight, and never on a step
  inside Clerk's flow (`isSafeMove`). The app's `UpdatePolicy`
  (`app/update-prompt.tsx`) sets the context (`appUpdateContext`) and
  reports route changes; `UpdatePrompt` only shows the controller's prompt.
  Anything a reload must not lose registers with it: `beforeUpdate(flush)`
  and `hold(write)` (the builder's draft autosave does both). Another tab's
  activation or storage upgrade (`replaced`) takes the same policy as
  "updated in another tab". A page shown again asks for a new worker at
  most every 10 minutes.
- `e2e/landing.preview.ts` proves the split on a build: nothing from the app
  chunk or Clerk before first paint, the prefetch after it, a recorded user
  never fetching the landing chunk.

## App shell

- **Routes** (`src/App.tsx`, React Router library mode): `/sign-in/*` and
  `/sign-up/*` (Clerk's forms, path routing, `AuthPage` in
  `app/auth-gate.tsx`; signed in, they go to `/`), `/about` (`AboutPage`:
  the landing page for everyone, never redirecting; "Open app" when the
  record or Clerk's session says someone is signed in), then behind
  `AuthGate`:
  `/`, `/workout/:sessionId`, `/history`, `/history/:sessionId`, `/programs`,
  `/programs/:id` (`screens/program-detail.tsx`), the builder's
  `/programs/new` and `/programs/:id/cycles/:n` (`screens/builder/`), and the
  catalog `/exercises` (`screens/exercises.tsx`). Signed out
  with no record, `AuthGate` shows the landing page at `/` (lazy, the same
  chunk); any other path waits (a "Loading…" frame) while Clerk loads, so a
  signed-in visitor with no record yet is never bounced, then sends a
  signed-out visitor to `/sign-in?redirect_url=<the path>` (offline: at
  once, where the page says a connection is needed). `AuthPage` returns
  there after signing in (`afterSignIn`: same-origin paths only, never the
  auth pages; Clerk's `forceRedirectUrl`). Clerk navigates through the
  router (`app/clerk-navigation.ts` lends it `navigate`), and both flows and
  sign-out end on `/`. Screens live in
  `src/screens/`, each under `AppHeader` (`src/app/app-header.tsx`: wordmark,
  the Programs and History links, sync line, theme, account, whose Clerk
  menu holds Manage account, "About Tanren" (`/about`) and Sign out; on a
  phone the sync line takes its own row and the theme toggle shows its
  glyph alone).
  `SyncAlert` under it explains a rejected or held lane in the server's
  words, naming the workout from `useSyncStatus().sessionId` (only that
  workout waits; others still sync); "Try again" is its lead action
  (recovering a rejected write by editing it is deferred to step 5, design
  D7), and a not-entitled refusal says billing is coming rather than
  showing a Subscribe control. `not-signed-in` from an action reads as
  "Sign in to start / continue …" (`screens/errors.ts`). Toasts land at the top (`Toaster` in `App.tsx`); the update prompt
  (mid-workout only) is one.
- **The workout screen** keeps its current exercise in the URL (`?ex=`,
  pinned on arrival so reaching the target never moves the screen) and
  opens a named set with `?set=` (the sync band's "Show set"). Skipping is
  navigation only; it writes nothing.
  The screen lives in `screens/workout/` (`workout.tsx`; the plan rules in
  `plan.ts`, the stopgap in `stopgap.tsx`, the edit sheet and finish dialog
  in `dialogs.tsx`). Steppers reseed after every logged set (`seed` in
  `plan.ts`):
  weight from the plan's prescribed weight for that set first (the plan is
  the plan: a written deload beats last time, which still shows inline;
  `prescribedWeight` converts one written in the other unit with
  `convertWeight` from `shared` to a whole lb or half kg), else the last set
  the server hasn't rejected, else last time's
  same set, else last time's first set, else blank; reps never below the
  plan's floor (the higher of last time's same set and the floor), with no
  floor last time's same set, else the last good set, else the plan's top
  of range. Planned rows in Today's log show each set's prescribed
  weight too. An effort target (`EffortTarget` in `lib/effort.ts`, one
  typed `{ scale, value }`, `effortAt`) sits beside the set's plan line and
  its planned row; the plan line is `SetFigures` with the rep range. Slots
  that aren't loggable yet (`ExerciseView.loggable`, from
  `local/loggable.ts`, design D12: a placeholder, or metrics other than
  exactly reps and weight) show in place with "Logging this arrives soon"
  and Skip, take no sets, and don't count toward the sets left. Every slot
  is named by `nameOf` (`local/loggable.ts`), here, on home and in the
  builder. Editing and
  deleting a set happen in a bottom sheet; finishing is a dialog that counts
  the planned sets left.
- **Home** (brief `.impeccable/surfaces/apps-web-src-home.md`): at left
  "What's next", unfinished workouts first (Continue, Finish & start next),
  then a card per active program (Start, Skip with a one-tap inline
  confirmation naming what moves up); at right "Your programs" (active and
  drafts, at most four, New program, All) and "Recent workouts". No
  programs: "Start your first program" (Pick a template opens the New
  program sheet; Create from scratch goes to `/programs/new`).
- **Programs** (`screens/programs.tsx`): Active, Drafts, Finished, then
  Archived (collapsed), each row with length, progress and a ⋯ menu
  (`ui/menu.tsx`: Rename, Copy, Archive or Activate); drafts Activate and
  Edit inline, finished fixed programs Run another cycle; the whole row links
  to the program (the name's `::after` covers the `relative` row; inline
  buttons and the ⋯ sit above it at `z-10`). The New program
  sheet (`screens/new-program-sheet.tsx`) holds the templates, from
  scratch, and copy. All plan-side, online only; offline the list stays
  readable and the actions say they need a connection. A program's page
  lists its cycles with Edit, or View once every workout in the cycle is
  logged (the detail's `fullyTrained`).
- **Builder** (`screens/builder/`, brief `.impeccable/surfaces/apps-web-src-builder.md`):
  `tree.ts` is the cycle as pure edits over a `BuilderState` (a
  `CreateState` with the new program's name and length, or an `EditState`
  with its `baseline` fingerprint), sent whole as the `cycleTree` (kept rows
  keep ids, new ones carry ids passed in: nothing in `tree.ts` mints).
  `reducer.ts` is the one `builderReducer` over it, `{ tree, dirty }` changing
  together; the action creators in `mintingActions` mint the ids. Trained
  workouts are kept as the stored node (`frozen`, sent back verbatim, with
  `trainedAt` beside it for "Logged <day> · locked", `relativeDay` in
  `screens/format.ts`). `routes.tsx` seeds the builder (draft, else a blank
  program or `seedFromRead`); `builder.tsx` is the page, the same for both;
  what differs is a `BuilderMode` (`modes.tsx`: heading, words, `fresh`,
  `submit`). Weights are prescribed in the unit the required `units` give
  for the slot's exercise (`resolveUnit`). Every edit lands in the device
  draft a beat later (`useDraftAutosave`, `draft.ts`: stored versioned and
  zod-parsed on read, an older shape discarded; read once on open by
  `useDraft`); Discard and Remove are one tap with an Undo toast. A save is
  one `SaveState` (`save-bar.tsx`). Saving an edited cycle rereads the apply
  preview: a moved fingerprint is the stale refusal (reload, the draft
  rebased by `rebase`), later cycles open `ApplySheet` (pre-checked matches,
  flagged differences, locked logged cycles), and an unanswered save is
  resent exactly as sent (kept by the state it was made from,
  `withKeptId`). The editor seeds from its own cycle read, refetched on
  open (`useCycle(…, { fresh: true })`, only data fetched after it opened),
  and `expected.source` is that read's `fingerprint` (D17), never the apply
  preview's; the preview gives only the later cycles and their
  fingerprints. A reload rebases on one fresh read and its fingerprint
  (`rereadCycle`). Drafts wait for an owner (`useOwnerId`): the screens show
  Loading until someone is known and are keyed by owner. The program page
  marks "View" from the detail's `fullyTrained`; it and the builder's strip
  read the ◆ differences from `useCycleDifferences`.
- **Exercise picker and catalog** (`screens/exercise-picker.tsx`,
  `exercises.tsx`, shared rows and filters in `exercise-list.tsx`): the
  catalog is read whole and filtered on the device (`screens/catalog.ts`);
  recently used is per user in `localStorage`. Catalog writes are online,
  with ids minted here and kept until success (`withKeptId`,
  `data/kept-id.ts`, like every plan-side write's): a create's id per user
  at module level (`pendingCreates` in `hooks.ts`), across edits and
  remounts; a replay answers with the row as first sent, and the edits
  since are sent as an edit (metrics can't change, so they stay as first
  sent).
- **Clerk's UI wears the tokens** (`src/app/clerk-appearance.ts`): every
  color is a `var(--token)`, so both themes follow with no copies. Clerk
  draws edges as box-shadows and outranks plain overrides; the few edge
  rules there carry `!important` on purpose. Its links are ink, underlined
  (copper is the primary action only), and the header's account control is
  a Card Stock square with the user glyph masked in `--text`, never Clerk's
  generated avatar.
- **Clerk is bundled** (`@clerk/clerk-js` + `@clerk/ui` passed to
  `ClerkProvider`, in the app chunk), never fetched from Clerk's CDN, and
  **never awaited** (design D10). `app-root.tsx` opens the data layer
  (IndexedDB, once per page), then renders. `AuthGate` renders
  from local data whenever a last signed-in user is recorded; `ClerkBridge`
  records that user only when `clerk.status === "ready"`. Nothing branches
  on `degraded`.
- **`apiFetch` / `apiRequest`** (`src/api.ts`) are the only callers of the API
  and the only code that sets `Authorization`. The token comes from
  `getAuthToken` (`src/auth.ts`), which never waits for Clerk to load
  (`AuthNotReadyError`) and never calls `getToken()` while
  `navigator.onLine` is false (`OfflineError`; Clerk's `clerk_offline` maps
  to it too). Errors: `ApiError` (`status`, server `reason`), `NetworkError`.
- **Service worker**: `vite-plugin-pwa` `generateSW`, `registerType:
  "prompt"` (the page decides when: `boot/updates.ts`), navigation fallback to
  `/index.html` except `/api/*`, 8 MiB precache limit for the app chunk
  (Clerk is most of it).

## Data layer (`src/local/`, design D7-D9)

- **One IndexedDB database** (`db.ts`, version 2): `meta` (last user,
  what's-next snapshot, program outlines), `queue`, `sessions`, `contexts`,
  and `drafts` (version 2, step 4a D14: the builder's unsaved work per user,
  program and cycle, `drafts.ts`; never synced). An upgrade keeps everything
  a version-1 device holds. Every connection closes itself on
  `versionchange` (`blocking`) and reports `replaced`, so a tab left open
  across a deploy never holds a new version's upgrade: the data layer
  closes and the update policy reloads (or, mid-workout, asks). An open that waits on an
  older tab reports `blocked` (`onLocalDbEvent`), and the bootstrap and
  `AppWithData` show `boot/upgrade-blocked.tsx` until it goes. Bump the
  version only with an upgrade step for every older one.
- **The mutation queue** (`queue.ts`) is the only way a logging write reaches
  the API. One IndexedDB store keyed by sequence, split into **lanes, one per
  session**: a lane sends its oldest item only, so a session's writes arrive
  in order. A lane that is held, rejected or backing off stops only itself;
  other sessions keep syncing. One flusher (Web Locks) and one request in
  flight overall, always the lowest-sequence ready lane head; each send is
  abandoned after 20s (`REQUEST_TIMEOUT_MS`, a retry), so a hung request
  can't block every lane.
- Failures classify as retry (offline, network, timeout, 5xx, 408, 429, Clerk not
  loaded, or any 4xx without our API's `{ ok: false, error }` body, i.e. the
  edge; backoff per lane, 1s doubling to 30s), refresh (401: one `skipCache`
  token, then resend) or rejected (our API's JSON 4xx: that lane stops at the
  item and keeps it, with the server's reason). Flushes on enqueue, `online`,
  app start and Clerk loading (all retry every backing-off lane now, even a
  send that fails while the trigger arrives), and on the backoff timer
  (releases only the lanes due). A write stamped with
  another account is held, never sent.
- **Who owns a write** (`DataLayer.userId()`): Clerk's signed-in user as soon
  as Clerk has one, else the last recorded user; with neither, local writes
  refuse (`LocalSessionError` `not-signed-in`). The stamp only decides
  holding; the server checks every write against a verified token.
- **The session record** (`sessions.ts`) is what the logger renders. Each
  operation updates the record and enqueues its validated wire request in
  **one IndexedDB transaction**. Ids come from `newId()`, timestamps from the
  device clock, the unit from `resolveUnit` (override first). Deleting
  renumbers locally exactly as the server does and removes an emptied
  exercise. A finished record is dropped once all its writes are acked, and
  on load if it has nothing left queued (an ack whose follow-up never ran).
- **Prefetch** (`contexts.ts`): when what's next loads online, every listed
  workout's context is stored, so a start works offline. If it loads before
  any user is known, it is stored as soon as one is. Each listed program's
  **outline** (`outline.ts`: the next's cycle, and the following one when a
  fixed program has it) is stored too, with the context of the workout
  after each next.
- **Server reads on screens** follow one order (`ServerRead`,
  `screens/server-read.tsx`): the data once loaded, else the offline state,
  else the failure with "Try again" (`RetryNotice`), else a skeleton. A
  line saying something waits for a connection is `OfflineLine`
  (`screens/notice.tsx`). Home's left column is `homeMode`
  (`screens/home-mode.ts`).
- **The query cache** (`data/queries.ts`): every key from `keys`, the shared
  read options from `serverQueries`, and `AFFECTS`, the one table of what
  each write makes stale: every mutation's `onSuccess` and the queue's ack
  listener (`DataProvider`) refresh through it (`refreshAfter`). A delivered
  start, finish or skip refreshes the program's detail, cycles and outline
  too (trained flags), not only what's next. Mutations default to
  `networkMode: "always"` (`createQueryClient`): plan-side, online only.
- **Skip** (`sessions.skip`, step 4a D15): a SKIPPED record plus a queued
  `POST /api/workouts/:id/skip` in its own lane, like a start; refused for a
  workout this device started. `deviceNext` moves what's next past every
  workout finished or skipped here (and past one delivered since the last
  server read, `settledWorkouts`), so home moves on offline; an open-ended
  program's new cycle waits for the server (`waiting`). The outline keeps
  each workout's `trained` flag from the cycle read, and a successor is
  never a trained workout (resolved or started elsewhere). A delivered
  finish or skip stays resolved until a what's-next read that began after
  it arrives (`settledMark`, compared in `buildNextView`,
  `local/next-view.ts`). Known gap: a
  skip the server rejects keeps its workout resolved on this device until
  step 5's discard (design D15).
- **Signing in** (`layer.signedIn`) forgets every other account's cached
  plan, session records without queued writes, and builder drafts, on every
  sign-in (a sign-out clears the record, so "a different last user" can't
  be the test).
- Never call `apiFetch` (or `fetch`) from logging code: use the hooks below.

## Hooks for screens (`src/data/hooks.ts`)

| Hook | Returns |
|---|---|
| `useNext()` | `{ next, waiting, inProgress, source, isLoading, error, successorOf }` (`buildNextView`): server what's next, else the device snapshot (`source: "device"`), moved past workouts finished or skipped here; local sessions merged into `inProgress` (`onDevice`, and `progress` over the loggable slots); `successorOf(workoutId)` names what follows (skip confirmation) |
| `useSessionRecord(id)` | `SessionView \| null`: each planned exercise (plan, `lastTime`, resolved `unit`) beside its logged sets, each with `sync: { state, reason? }` (`logged`, `queued-no-signal`, `queued-in-order`, `failed-retrying`, `rejected`) |
| `useWorkoutActions()` | `start(workoutId)`, `skip(workoutId)` (each serialized per workout: overlapping calls share one result and one queued write), `logSet(sessionId, { plannedExerciseId, reps, weight })`, `editSet`, `deleteSet`, `finish`, `ensureOnDevice(entry)` (`DataLayer.ensureOnDevice`: online; brings a session started elsewhere across, its logged sets under their existing session-exercise rows; offline it refuses, `needs-connection`). Throw `LocalSessionError` (message is user-facing; `not-signed-in` when no user is known) |
| `useSyncStatus()` | `{ state: synced \| syncing \| offline \| retrying \| rejected \| held, pending, reason?, sessionId?, queued, retry() }`, aggregated across lanes; `sessionId` names the session a rejected, held or retrying state is about (the oldest); `retry()` resends every rejected lane; `pending` counts queued writes of every kind, `queued` (`data/queue-summary.ts`) says it in sets: `{ sets, workout, blocked }`, where `blocked` names the rejected write's session, op and set. Screens show `queued`, never `pending` |
| `useWorkoutPreview(workoutId)` | the workout's cached context (device only, works offline), for home's previews; `null` if never prefetched |
| `useFinishAndStartNext()` | `(entry, successor)`, over `DataLayer.finishAndStartNext`: queues the finish, then starts the program's next workout as the device computes it. The finish and the start are separate lanes (one per session), so the start never waits behind the finish offline; rolling an open-ended program over online, it kicks the queue and waits until the finish is delivered, rereads what's next, then starts the new cycle's first workout (still in flight: returns `finished`, waiting) |
| `useTemplates()`, `useStartProgram()` | template list; start a program (online, id kept across retries) |
| `usePrograms()`, `useProgramActions()` | the program list; `rename`, `copy`, `activate`, `archive`, `extend` mutations (online only; copy and extend keep their minted id until success) |
| `useProgram(id)`, `useCycle(id, n)`, `useCycles(id, ns)` | a program and its cycles' trained flags; one cycle's tree (workouts carry `trained` and `trainedAt`); several. A missing id skips the read |
| `useApplyPreview(id, n)`, `useCycleDifferences(id)` | a cycle's fingerprint and its later cycles' status; which cycles differ from cycle 1 (◆). A save rereads the preview with `rereadApplyPreview` (`queries.ts`), never the cache |
| `useCreateProgram()`, `useSaveCycle()` | the builder's two writes (online; the program id is minted with the draft) |
| `useDrafts()`, `useOwnerId()` | `{ drafts, userId }`: the device draft store and whose drafts to read; who owns the device's data |
| `useUnits()` | the lifter's weight units from the catalog read (`GET /exercises` carries `units`); offline before any read, the newest cached workout context, else lb. `undefined` only while the catalog is on its way. A slot's unit is `resolveUnit(units, exerciseId)` |
| `useExercises()`, `useExerciseActions()` | the whole catalog (retired own exercises included); `create`, `edit`, `notes`, `retire`, `reactivate` (online, ids kept until success; each answer replaces the cached row) |
| `useHistory()`, `useSessionDetail(id)` | paged history (`useInfiniteQuery`); one session |
| `useOnline()`, `useLastUser()`, `useAuthReady()` | connectivity, recorded user, Clerk loaded with a session |

## Tests

- `npm test -w @workout-tracker/web`: Vitest + Testing Library (jsdom) for
  components, hooks and the data layer, `src/**/*.test.{ts,tsx}`. IndexedDB
  is `fake-indexeddb`; `src/test/fakes.ts` has `makeHarness()` (a data layer
  with a fake API server that applies writes like the services, manual
  timers and a switchable connection). Reuse a harness's `dbName` to
  simulate a reload.
- `npm run test:e2e -w @workout-tracker/web`: Playwright, two projects
  (`playwright.config.ts`). `dev`: `e2e/*.spec.ts` against the dev server,
  the kit included. `preview`: `e2e/*.preview.ts` against a production build
  served by `vite preview` (built to `.e2e/dist` with `--mode development`
  for Clerk's development key; still a production bundle), because only a
  build has the service worker an offline reload needs and the real chunks:
  `offline.preview.ts` is task 10.2 (it enters through the landing page's
  "Log in"), `landing.preview.ts` the chunk split and `/about`,
  `update.preview.ts` the update policy (build A, then a build B derived
  from it, from its own switchable static server). Needs `npx playwright install chromium`
  once; not part of CI's `npm test`. The screen specs fake the API in the
  browser (`e2e/support/fake-api/`: `router.ts` is `FakeApi`; in-memory,
  applies writes like the services, with their replay rules and words and
  their own cycle normalizer, `@workout-tracker/db/fingerprint`, which only
  the e2e fake may import; every response parsed with its `shared` schema)
  and sign in to
  Clerk's development instance for real through the bundled form
  (`e2e/support/session.ts`: `signIn` opens `/sign-in`;
  `spike+clerk_test@example.com`, code 424242; sign in only, never sign up). In the dev server `window.Clerk` is not the
  instance React holds, so signing in through it doesn't reach the app.
