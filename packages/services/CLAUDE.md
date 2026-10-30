# packages/services

Every user operation as a plain async function; `apps/api` routes and the
`apps/mcp` tools (step 6) are thin adapters. Spec: `docs/operations.md`;
procedure: the `implement-operation` skill.

## Shape

- `fn(db: Db, user: UserId, ...input) => Promise<result>`. `input` is already
  parsed with the `packages/shared` Zod schema; results satisfy its response
  schema. No HTTP: no Hono, Request/Response, status codes or headers.
- Lifter-actionable failures throw `ServiceError` (`src/errors.ts`), kind
  `not_found | invalid | conflict | forbidden`, message shown verbatim and
  naming the workout/slot. `forbidden` is entitlement only (the web reads 403
  as "not entitled"); other refusals are `invalid` or `conflict`.
- Writes run in `transact(db, fn)`, which translates scoping errors and
  Postgres unique/check/FK violations, deferred uniques at COMMIT included.

## Rules

- Scope every query with `userScope` / `assertOwned` / `assertExercisesUsable`
  from `packages/db`; never an inline `user_id` filter. Sets count only through
  `countsAsSet`. Need a `packages/db` helper? Ask `db`; never edit it.
- Client-minted ids: `ON CONFLICT (id) DO NOTHING`, then re-read through
  `userScope` (or count `RETURNING`); a mismatch is `conflict`. A replay
  returns the same answer and writes nothing (tests assert `xmin`).
- `src/rows.ts:resolvingSession` is the one "resolved" condition;
  `src/plan.ts:advanceProgram` the one roll-over (finish, skip, activate,
  cycle save), and `appendCycle` the one "clone the last cycle as the next"
  (roll-over, extend).
- **Plan files:** `src/plan.ts` (lock, roll-over, summaries, trained),
  `src/tree.ts` (cycle-tree rows, client-minted inserts with
  `assertAllWritten`, `insertCycleTree` and its checks), `src/cycles.ts`
  (`loadCycles`, the cycle read, apply preview and save), `src/programs.ts`
  (one create path -- create, template start and copy -- reads, lifecycle).
- **Program lock:** every write to an existing plan -- save cycle, copy (the
  source), extend, activate, archive, rename, skip -- starts with
  `src/plan.ts:lockProgram` (`FOR UPDATE`), the lock `finishWorkout` takes.
- **Names:** `src/names.ts` only. Copy and template start auto-suffix; create
  and rename refuse an exact clash; exercise names clash ignoring case.

## Tests

`npm test -w @workout-tracker/services` runs `test/` on a fresh, seeded Neon
branch; tests commit (`test/db.ts`). Force races with an open transaction
holding a lock (`blockedBy`), never `Promise.all` alone.
