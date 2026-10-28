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
  weight, rep and time. Shippori Mincho B1 is only the two wordmark kanji,
  shipped as the two Fontsource subset files that contain them.
- **Primitives live in `src/ui/`**, shadcn/ui-style (`components.json`, `cn`
  in `src/lib/utils.ts`, `@/` = `src/`). Restyle shadcn components into the
  world when adding them; never ship one stock.
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

## App shell

- **Routes** (`src/App.tsx`, React Router library mode): `/`,
  `/workout/:sessionId`, `/history`, `/history/:sessionId`. Screens live in
  `src/screens/`, each under `AppHeader` (`src/app/app-header.tsx`: wordmark,
  sync line, theme, account; on a phone the sync line takes its own row).
  `SyncAlert` under it explains a rejected or held lane in the server's
  words, naming the workout from `useSyncStatus().sessionId` (only that
  workout waits; others still sync); "Try again" is its lead action
  (recovering a rejected write by editing it is deferred to step 5, design
  D7), and a not-entitled refusal says billing is coming rather than
  showing a Subscribe control. `not-signed-in` from an action reads as
  "Sign in to start / continue …" (`screens/errors.ts`). Toasts land at the top (`Toaster` in `App.tsx`); the update prompt
  is one.
- **The workout screen** keeps its current exercise in the URL (`?ex=`,
  pinned on arrival so reaching the target never moves the screen) and
  opens a named set with `?set=` (the sync band's "Show set"). Skipping is
  navigation only; it writes nothing.
  Steppers reseed after every logged set (`seed` in `screens/workout.tsx`):
  weight from the last set the server hasn't rejected, else last time's same
  set, else blank; reps never below the plan's floor (the higher of last
  time's same set and the floor), with no floor last time's same set, else
  the last good set. Editing and deleting a set happen in a bottom sheet; finishing is a
  dialog that counts the planned sets left.
- **Home** with a program uses the logger's split: what's next at left,
  "Recent workouts" (`useHistory`, first page) at right with the History
  link on its heading; with none, the templates at full width.
- **Clerk's UI wears the tokens** (`src/app/clerk-appearance.ts`): every
  color is a `var(--token)`, so both themes follow with no copies. Clerk
  draws edges as box-shadows and outranks plain overrides; the few edge
  rules there carry `!important` on purpose. Its links are ink, underlined
  (copper is the primary action only), and the header's account control is
  a Card Stock square with the user glyph masked in `--text`, never Clerk's
  generated avatar.
- **Clerk is bundled** (`@clerk/clerk-js` + `@clerk/ui` passed to
  `ClerkProvider`), never fetched from Clerk's CDN, and **never awaited**
  (design D10). `main.tsx` opens IndexedDB, then renders. `AuthGate` renders
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
  "prompt"` (`src/app/update-prompt.tsx`), navigation fallback to
  `/index.html` except `/api/*`, 8 MiB precache limit for the Clerk chunk.

## Data layer (`src/local/`, design D7-D9)

- **One IndexedDB database** (`db.ts`): `meta` (last user, what's-next
  snapshot), `queue`, `sessions`, `contexts`.
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
  any user is known, it is stored as soon as one is.
- Never call `apiFetch` (or `fetch`) from logging code: use the hooks below.

## Hooks for screens (`src/data/hooks.ts`)

| Hook | Returns |
|---|---|
| `useNext()` | `{ next, inProgress, source, isLoading, error }`: server what's next, else the device snapshot (`source: "device"`); local sessions merged into `inProgress` (`onDevice`) |
| `useSessionRecord(id)` | `SessionView \| null`: each planned exercise (plan, `lastTime`, resolved `unit`) beside its logged sets, each with `sync: { state, reason? }` (`logged`, `queued-no-signal`, `queued-in-order`, `failed-retrying`, `rejected`) |
| `useWorkoutActions()` | `start(workoutId)`, `logSet(sessionId, { plannedExerciseId, reps, weight })`, `editSet`, `deleteSet`, `finish`, `adopt(entry)` (online; brings a session's logged sets across under their existing session-exercise rows). Throw `LocalSessionError` (message is user-facing; `not-signed-in` when no user is known) |
| `useSyncStatus()` | `{ state: synced \| syncing \| offline \| retrying \| rejected \| held, pending, reason?, sessionId?, queued, retry() }`, aggregated across lanes; `sessionId` names the session a rejected, held or retrying state is about (the oldest); `retry()` resends every rejected lane; `pending` counts queued writes of every kind, `queued` (`data/queue-summary.ts`) says it in sets: `{ sets, workout, blocked }`, where `blocked` names the rejected write's session, op and set. Screens show `queued`, never `pending` |
| `useWorkoutPreview(workoutId)` | the workout's cached context (device only, works offline), for home's previews; `null` if never prefetched |
| `useTemplates()`, `useStartProgram()` | template list; start a program (online, id kept across retries) |
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
  build has the service worker an offline reload needs:
  `offline.preview.ts` is task 10.2. Needs `npx playwright install chromium`
  once; not part of CI's `npm test`. The screen specs fake the API in the
  browser (`e2e/support/fake-api.ts`: in-memory, applies writes like the
  services, every response parsed with its `shared` schema) and sign in to
  Clerk's development instance for real through the bundled form
  (`e2e/support/session.ts`: `spike+clerk_test@example.com`, code 424242;
  sign in only, never sign up). In the dev server `window.Clerk` is not the
  instance React holds, so signing in through it doesn't reach the app.
