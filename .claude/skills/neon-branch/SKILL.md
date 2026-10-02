---
name: neon-branch
description: Get a working Postgres connection — run a query by hand, apply a migration locally, or spin up a disposable Neon branch for integration tests. Use whenever a task needs a real database rather than a mock, or when you need the pooled/direct connection string.
---

# Neon: branches and connection strings

Neon is **not in CDK** — it is not an AWS resource. The project, its branches,
and the SSM parameters holding its connection strings are created and managed by
hand. There is deliberately no Neon deploy tooling (`neon.ts`, `neon deploy`):
schema changes go Drizzle → generated migration → CI, and nothing else touches
database structure.

Project: `super-bar-40420599`, AWS `us-east-2`, default branch `production`,
plus a long-lived `dev` branch. Verify with `neon branches list` rather than
trusting this file — the build plan's step 0 and step 1 prose disagree on when
`dev` was created.

## Getting a connection string

Four parameters, SSM Parameter Store, `us-east-2`, `SecureString`:

```
/workout-tracker/production/database-url-pooled   Lambda runtime
/workout-tracker/production/database-url-direct   CI migrations
/workout-tracker/dev/database-url-pooled          dev runtime
/workout-tracker/dev/database-url-direct          dev migrations
```

```bash
aws ssm get-parameter --with-decryption --profile workout-tracker \
  --region us-east-2 --name /workout-tracker/dev/database-url-pooled \
  --query Parameter.Value --output text
```

Needs a live SSO session: `aws sso login --profile workout-tracker` (8 hours).

**Pooled vs direct.** Pooled (`-pooler.` in the hostname) is for the runtime.
Direct is for migrations — PgBouncer in transaction mode breaks the
session-level features migration tools need. The Lambda asserts at cold start
that its string contains `-pooler.`, so a swapped parameter fails loudly.

Never paste a connection string into a file, a test fixture, or a commit. They
live in SSM and in your shell for the length of one command.

## A branch per feature branch

Branches are copy-on-write, cheap, and disposable. That is the whole point with
agents in the loop: get your own database, break it freely, delete it on merge.

```bash
neon branches create --name <feature-branch-name> --parent dev
# ... work ...
neon branches delete <feature-branch-name>
```

Delete it when the feature merges. An orphaned branch is a small bill and a
large source of "which database am I looking at?".

## Integration tests

The definition of done requires **integration tests against a real Neon branch,
not mocks**, for anything touching:

- the clone primitive (`operations.md` §0.2),
- the "what's next?" query (§4.1),
- offline replay / idempotent reinsert (§2.11 of the data model),
- the user-scoping helper.

Those four are exactly the places where a mock agrees with your wrong mental
model. Everything else can use ordinary unit tests.

Point tests at a per-run branch, run migrations against its **direct** string,
and tear the branch down afterwards.

## Driver

`@neondatabase/serverless`, the **WebSocket** `Pool` — never the HTTP driver.
HTTP cannot do interactive transactions, and the clone primitive, copy-program,
activate, and finish-and-maybe-extend all read a level then write the next. The
failure surfaces at step 4, long after the choice.

Create the pool at module scope so it survives invocations; never `pool.end()`
per request.

## Autosuspend

Free-tier compute suspends after inactivity and takes roughly half a second to
wake. The first query of a session — and the first test in a run — pays it.
That is normal, not a bug to chase.
