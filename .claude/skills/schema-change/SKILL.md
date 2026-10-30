---
name: schema-change
description: Change the database schema — add or alter a table, column, index, or enum — via the Drizzle schema and a generated migration. Use for any "add a field / new table / change a constraint / seed the exercise catalog" task, and whenever docs/data-model.md DDL and the code might disagree.
---

# Changing the schema

## Where the truth lives

**`packages/db/src/schema.ts`** is the source of truth for every table that
exists. `docs/data-model.md` §3 holds the *reasoning* behind each table, not its
DDL — with one marked exception that is still spec because its table does not
exist yet: `processed_stripe_events` (§3.8, step 5). The change that adds it to
`schema.ts` deletes its block from the doc. Never re-add DDL to the doc for a table that is in the schema file.

## The loop

1. Edit the Drizzle schema file. Never edit the SQL directly.
2. `npm run generate -w @workout-tracker/db` → a new migration in
   `packages/db/migrations/`.
3. Read the generated SQL before committing it. Drizzle will happily emit a
   drop-and-recreate for something you meant as a rename.
4. Commit schema + migration together.
5. Apply it — see "Applying" below.

**Never edit a migration that has already been applied anywhere.** Generate a
new one that corrects it. This is the single most likely wrong turn on this
task: asked to fix the schema, the obvious-looking move is to rewrite the last
migration, and it silently diverges every environment that already ran it.

**Never hand-edit a generated migration**, applied or not. If the generated SQL
is wrong, the schema file is wrong — fix that and regenerate.

**The one exception: what Drizzle cannot express.** `DEFERRABLE` has no Drizzle
API, so the two position uniques are declared as plain uniques and made
deferrable by `drizzle-kit generate --custom` (an empty file you write by hand —
the sanctioned path, not a hand-edit of generated SQL). drizzle-kit cannot see
custom SQL: change either constraint's columns and it recreates the constraint
*without* `DEFERRABLE`, silently. Follow any such migration with another
`--custom` one; `packages/db/test/schema.test.ts` fails if you forget. Anything
else Drizzle turns out not to express gets the same treatment *and* a test.

## Applying

Migrations run **from CI only**, against a connection string. No ad-hoc laptop
migrations against `production`.

Use the **direct** (non-`-pooler`) connection string. PgBouncer in transaction
mode breaks the session-level features migration tools rely on:

```
/workout-tracker/production/database-url-direct   CI migrations
/workout-tracker/dev/database-url-direct          dev migrations
```

(SSM Parameter Store, `us-east-2`, `SecureString`.) Iterating locally: apply
against a throwaway Neon branch, not `dev` and never `production` — see the
`neon-branch` skill. `npm test -w @workout-tracker/db` does this for you: it
creates a branch off `dev`, migrates it, runs the integration tests, and deletes
it.

CI (`.github/workflows/ci.yml`) is the only path to `dev` and `production`: on
merge to `main` it runs the checks, then migrates `dev`, then `production`. A
migration therefore reaches a shared database only after it has merged and its
tests have passed.

## The exercise catalog is content, not schema

Standard exercises live in `packages/db/src/catalog.ts`, not in a migration
(spec step 2, decision 8). To change the catalog, edit that file — nothing else:

- **New entry:** a new UUIDv7 literal, minted once
  (`node -e "import('uuid').then(u=>console.log(u.v7()))"`). Never regenerate,
  reuse or reorder existing ids; every environment's plans point at them.
- **Remove an exercise:** set `isActive: false`. Deleting the entry leaves the
  row (it is `RESTRICT`ed from plans and history).
- **Change metrics:** edit the entry's `metrics`. A metric dropped from an entry
  is deleted on the next seed, for listed exercises only.

`npm run seed -w @workout-tracker/db` applies it. CI runs it after every
migration on `dev` and `production`; it is idempotent, so an unchanged file
writes nothing. Like migrations, never run it by hand against either.
`test/catalog.test.ts` checks the file; `test/seed.test.ts` checks the seed.

## Non-negotiables for new tables

- Primary key is **UUIDv7 minted in application code**. No `DEFAULT gen_random_uuid()`,
  no serial. The id doubles as the idempotency key.
- Anything user-owned is reachable through the scoping helper in `packages/db`.
  Add it to the helper in the same change, not later.
- New enum value? Grep for every `CASE` over that enum. The unit-conversion
  `CASE`s name every value and have no `ELSE` (`data-model.md` §2.5) precisely
  so this breaks the build instead of silently defaulting.

## Plan tables and the cycle fingerprint

A migration that touches `workouts` or any `planned_*` table must update the
cycle fingerprint normalizer in `packages/db/src/fingerprint-core.ts`, and
the stored-cycle read and its `StoredCycle*` types in
`packages/db/src/fingerprint.ts`, in the same change. Decide whether each new or changed column is authoring (included) or
annotation (excluded, like `notes`). Then update its tests,
`packages/db/test/fingerprint.test.ts` and
`packages/db/test/fingerprint-stored.test.ts`. The column-coverage test fails
on a new column until you decide.

## Schema docs

Generated from the Drizzle schema as a build step. Do not hand-write them, and
do not "helpfully" update a generated artifact.
