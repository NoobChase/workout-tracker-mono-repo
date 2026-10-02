---
name: schema-change
description: Change the database schema — add or alter a table, column, index, or enum — via the Drizzle schema and a generated migration. Use for any "add a field / new table / change a constraint / seed the exercise catalog" task, and whenever docs/data-model.md DDL and the code might disagree.
---

# Changing the schema

## Where the truth lives — check this first

`packages/db/src/index.ts` is still a placeholder as of build step 1, so
**`docs/data-model.md` §3 and `docs/schema.dbml` are authoritative right now**.
The moment a Drizzle schema file exists, that inverts:

- the Drizzle schema file becomes the source of truth, and
- the DDL in `docs/data-model.md` and the whole of `docs/schema.dbml` get
  **deleted** in that same change. The *reasoning* prose in `data-model.md`
  stays — that is the part that cannot be regenerated and does not rot.

Three hand-maintained copies of one schema is two too many, and the stale ones
are what an agent reads.

## The loop

1. Edit the Drizzle schema file. Never edit the SQL directly.
2. `drizzle-kit generate` → a new migration file.
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
`neon-branch` skill.

As of step 1 there is no CI workflow yet. If you are the change that needs one,
building it is part of the task, not a follow-up.

## Non-negotiables for new tables

- Primary key is **UUIDv7 minted in application code**. No `DEFAULT gen_random_uuid()`,
  no serial. The id doubles as the idempotency key.
- Anything user-owned is reachable through the scoping helper in `packages/db`.
  Add it to the helper in the same change, not later.
- New enum value? Grep for every `CASE` over that enum. The unit-conversion
  `CASE`s name every value and have no `ELSE` (`data-model.md` §2.5) precisely
  so this breaks the build instead of silently defaulting.

## Schema docs

Generated from the Drizzle schema as a build step. Do not hand-write them, and
do not "helpfully" update a generated artifact.
