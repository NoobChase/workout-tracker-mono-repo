---
name: verify-done
description: Check a change against this project's definition of done before calling it finished. Use before reporting a task complete, opening a PR, or saying "that works" — and whenever you have written code but not yet run it.
---

# Is it actually done?

`CLAUDE.md` defines done once. This is how to check each clause, in order.
Report the results, including what failed.

## 1. It compiles and lints

```bash
npm run typecheck        # all workspaces
npm run lint             # see the honest note below
```

`npm run lint` is currently a **no-op** — no linter is configured in any
workspace, so the "lint passes" clause is vacuous. Do not report it as passing.
Say it is unconfigured, or configure one if that is what the task is.

## 2. Tests exist for the behavior and pass

```bash
npm test                 # all workspaces
```

"Tests exist" means tests for **this behavior**, not that the suite still runs.

Integration tests against a real Neon branch — not mocks — are required for:

- the clone primitive (`operations.md` §0.2)
- the "what's next?" query (§4.1)
- offline replay / idempotent reinsert
- the user-scoping helper

See the `neon-branch` skill. A mock here agrees with whatever you already
believed, which is the one thing you need the test to challenge.

For a new assertion on something subtle: invert it, confirm it fails, restore
it. An assertion that has never failed proves nothing.

## 3. It matches `docs/operations.md`

Open the numbered section and check three things concretely:

- **Rows written** — exactly those, no extras. A set that did not happen is no
  row; no pre-created empties.
- **Transaction boundary** — where the spec puts it.
- **Idempotency** — replay the mutation with the same UUIDs and confirm it is a
  no-op, not a duplicate.

And check the shared primitives were used, not reimplemented: the scoping
helper, the "a set that counts" predicate, the clone primitive, the
no-`ELSE` unit `CASE`.

## 4. No hand-edited generated artifacts

`git diff` the migrations and any generated schema docs. An applied migration
must never be edited — a correction is a new migration.

## 5. You ran it

"Wrote code" is not "works". Exercise the actual path:

- API change → call it through CloudFront, not just a unit test. See `deploy`.
- Infra change → `cdk diff` shows no drift after deploying.
- UI change → load it in a browser.
- Anything offline → queue it with the network off, restore, confirm replay.

If you could not run it, say exactly that and why. An unverified claim of
completion costs more than an honest "written, not yet run".
