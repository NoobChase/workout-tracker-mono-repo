# packages/services

The service layer (design D1 of `openspec/changes/step-3-vertical-slice`): every
user operation as a plain async function. `apps/api` routes and, in step 6, the
`apps/mcp` tools are thin adapters over it. Operations are specified in
`docs/operations.md`; the `implement-operation` skill is the procedure.

## Shape

- `fn(db: Db, user: UserId, ...input) => Promise<result>`. `input` is already
  parsed with the `packages/shared` Zod schema; results satisfy the matching
  response schema where one exists (`LoggedSet`, `StartedSession` have none).
- **No HTTP.** No Hono, no Request/Response, no status codes, no headers.
- Failures the lifter can act on throw `ServiceError` (`src/errors.ts`) with
  `kind`: `not_found | invalid | conflict | forbidden` and a message written
  to be shown verbatim. The adapter maps kinds to 404/400/409/403. Anything
  else thrown is a server fault (retryable).
- Writes run inside `transact(db, fn)`, which also translates scoping errors
  and Postgres unique/check/FK violations, including deferred uniques that only
  fire at COMMIT.

## Rules

- Scope every query with `userScope` / `assertOwned` from `packages/db`; never
  an inline `user_id` filter. Count sets only through `countsAsSet`.
- Client-minted ids: `ON CONFLICT (id) DO NOTHING`, then re-read through
  `userScope` and check the parent; a mismatch is `conflict`. A replay must
  return the same answer and write nothing (tests assert `xmin`).
- `src/rows.ts:resolvingSession` is the one "workout is resolved" condition;
  what's-next and the finish's exhaustion check must both use it.
- Need a `packages/db` helper? Write it here or ask `db`; never edit that package.

## Tests

`npm test -w @workout-tracker/services` creates a Neon branch off `dev`,
migrates and seeds it through `packages/db`'s scripts, runs `test/`, and
deletes it. Services commit their own transactions, so tests commit for real
(`test/db.ts`: `newUser`, `cleanup`). Force races with an open transaction
holding a lock (`test/finish.test.ts`), never `Promise.all` alone.
