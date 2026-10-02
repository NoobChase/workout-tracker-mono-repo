---
name: implement-operation
description: Implement a user-facing operation (start a workout, log a set, create/copy/extend a program, activate, finish, import/export) in the service layer. Use when a task maps to a numbered section of docs/operations.md, or when adding a route, MCP tool, or query that reads or writes the plan or session tables.
---

# Implementing an operation

Every user action already has a row-level specification. Do not design one.

## 1. Find the spec before writing code

- `docs/operations.md` — the numbered section for this action: exact rows
  written, transaction boundary, idempotency. `grep -n '^###' docs/operations.md`
  to locate it.
- `docs/data-model.md` §7 — the settled-decisions table. If your instinct
  contradicts a row in it, your instinct is wrong and it is not reopened here.
- `docs/worked-example.md` — real rows to sanity-check the query against.

If the operation genuinely is not in `docs/operations.md`, stop and say so. A
missing operation is a design gap to be decided, not improvised in a service
function.

## 2. Write it in the service layer

`packages/db` owns queries; the service layer owns operations; routes and MCP
tools are adapters with no logic. `startWorkout()`, not a route handler that
happens to contain the transaction.

The rule to check yourself against: could this function be called from the MCP
server tomorrow with no HTTP object in sight? If not, it is in the wrong layer.

## 3. The four shared primitives — never reimplement

| Thing | Where | Why it is shared |
|---|---|---|
| User scoping | the scoping helper in `packages/db` | It also enforces the cross-tenant invariants the schema deliberately does not. An inline `WHERE user_id = …` skips those. |
| "A set that counts" | the predicate helper in `packages/db` | `parent_set_id IS NULL AND kind <> 'WARMUP'`. Every count, chart, PR check and progression query must agree, including on drop sets. |
| The clone primitive | `packages/db`, per `operations.md` §0.2 | Create-program, copy-program and apply-edit-to-remaining-cycles are the *same* operation. Three copies will diverge. |
| Unit conversion | `data-model.md` §2.5 | The `CASE` names every enum value and has no `ELSE`. A new enum value must break the build, not silently fall through. |

## 4. Ids and idempotency

UUIDv7, minted in application code, never a database default. The id is the
idempotency key: inserts are `ON CONFLICT (id) DO NOTHING`, so replaying a
mutation is a no-op rather than a duplicate.

The clone mints the whole `old_id → new_id` map for a level before writing it —
no `RETURNING`, no rejoin, one pass per level, and rerunnable.

## 5. Sessions never touch the plan

Deviations — substitution, skipping, extra sets, improvised exercises — write to
`session_*` tables only. A set that did not happen is **no row**. Never
pre-create empty set rows to fill in later.

## 6. Offline

Only `operations.md` §4.2 and §4.3–4.14 run offline. Those writes go through the
ordered, serial-per-session mutation queue — never a bare `fetch` from the
logging UI. §4.13's program-extension check runs when the finish reaches the
server, not when the user taps the button.

Everything in §1, §2, §3 and §5 is online-only. Do not add offline support to a
plan-side operation to be helpful.

## 7. Entitlement

`requireAuth` on everything. `requirePro` (`sub_status IN ('TRIALING','ACTIVE')`)
only on progression analytics and MCP tools. There is no `sub_tier` column.
Hardcoded-entitled until build step 5 — wire the middleware now, flip the source
later.

## 8. Done

Run `/verify-done`. Anything touching the clone primitive, the "what's next?"
query, offline replay, or the scoping helper needs an integration test against a
real Neon branch — see the `neon-branch` skill — not a mock.
