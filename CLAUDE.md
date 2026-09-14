# Workout Tracker

A paid, US-only workout tracking PWA (React + Hono on Lambda + Neon Postgres),
rebuilt from scratch. Users can connect their own AI (import/export format +
MCP server) — we never pay for inference.

## Read this first

The design is fully specified in `docs/` **before** code exists. When docs and
your instincts disagree, the docs win; when docs and code disagree after a
feature ships, the code wins and the doc should be fixed.

| Doc | What it governs |
|---|---|
| `docs/workout-tracker-build-plan.md` | Stack, repo layout, build order (steps 0–6), per-step pitfalls |
| `docs/data-model.md` | Schema + the reasoning behind every decision. §7 is the settled-decisions table — **do not relitigate entries in it** |
| `docs/operations.md` | Every user action → exact rows written, transaction boundaries, the clone primitive |
| `docs/worked-example.md` | Row-level walkthrough; use it to sanity-check queries |
| `docs/legacy-*` | Reference only. Never copy anything from legacy |

## Non-negotiable rules

- **Primary keys are UUIDv7 minted in application code**, never database
  defaults. The id doubles as the idempotency key (`ON CONFLICT (id) DO NOTHING`).
- **Once `packages/db` exists, the Drizzle schema file is the source of truth.**
  Never edit an applied migration — generate a new one. On landing `packages/db`,
  delete the DDL from `docs/data-model.md` and `docs/schema.dbml` (the reasoning
  prose stays).
- **Every query is scoped through the shared user-scoping helper** in
  `packages/db`. Never write an inline `WHERE user_id = …`; the helper also owns
  the cross-tenant invariants the schema deliberately doesn't enforce.
- **"A set that counts"** is the shared predicate
  `parent_set_id IS NULL AND kind <> 'WARMUP'` — one helper in `packages/db`,
  used by every count, chart, PR check, and progression query. Never inline it.
- **Sessions never mutate the plan.** Deviations write to `session_*` tables
  only. A set that didn't happen is *no row* — never pre-create empty set rows.
- **Unit conversion `CASE`s name every enum value and have no `ELSE`**
  (`data-model.md` §2.5).
- **Service layer is HTTP-agnostic** (`startWorkout()`, not route handlers with
  logic). Lambda routes and MCP tools are both thin adapters over it.
- **Entitlement**: `requireAuth` on everything; `requirePro`
  (`sub_status IN ('TRIALING','ACTIVE')`) on progression analytics and MCP tools
  only. Hardcoded-entitled until build step 5. There is no `sub_tier` column.
- **Everything is CDK except Neon.** Nothing is created in the AWS console.
- **Offline writes** go through the ordered, serial-per-session mutation queue —
  never a bare fetch from the logging UI.
- **Migrations run from CI only**, against a connection string. No ad-hoc
  laptop migrations.

## Definition of done

A task is complete when:

1. Code compiles with no type errors and lint passes.
2. Tests exist for the behavior and pass — for anything touching the clone
   primitive, the "what's next?" query, offline replay, or the scoping helper,
   integration tests against a real Neon branch, not mocks.
3. The behavior matches `docs/operations.md` for that operation (rows written,
   transaction boundaries, idempotency).
4. No hand-edited generated artifacts (migrations, schema docs).
5. You ran it — "wrote code" is not "works".

## Working conventions

- Specs in `specs/<feature>/` only for features touching the schema, auth, or
  multiple layers. Delete or archive a spec once its feature ships.
- npm workspaces; `packages/shared` holds Zod schemas imported by web, api, and
  mcp. `packages/db` holds Drizzle schema + the query helpers above.
- Nested `CLAUDE.md` per workspace for package-specific conventions; this file
  stays under 100 lines.
