# Step 2 — Auth and core schema

> **Status: SHIPPED (2026-10-25). This is a record, not a spec.**
>
> Specs govern before implementation; code governs after. Where this file and
> the code disagree, **the code is right and this file is stale.** It keeps only
> the decisions and failures a reader cannot reconstruct from the code — code
> comments cite them as "spec step 2, decision N", so the numbers are stable.
> Delete it once step 4 ships, or sooner if every decision below has a home in
> `docs/` or a code comment.

**Goal (met):** a request arrives with a Clerk token, is verified without a
per-request call to Clerk, and resolves to a row in `users` — with the
plan-side tables migrated from CI and the standard exercise catalog seeded at
fixed ids, served from `tanrenstrength.com`.

- A signed-out browser cannot reach an authenticated route; a signed-in one can.
- Signing in creates exactly one `users` row on the first request, none after.
- `requirePro` exists, gates `/api/analytics/*`, and reads `users.sub_status`.
- `users` and the eight plan-side tables are in `dev` and `production`, applied
  by CI only.
- The catalog is in both, with identical ids.
- The app is served from `tanrenstrength.com` over HTTPS, against Clerk's
  production instance.

## Decisions

**1. `verifyToken` against a JWKS cached per execution environment, not a
pinned PEM.** Clerk is never called on the request path either way; the cached
JWKS survives a signing-key rotation with no manual step (it refetches on an
unknown `kid`), where a pinned PEM makes rotation a coordinated hand-edit that
rejects every token if wrong. The PEM's one advantage, surviving a Clerk outage,
is illusory: session tokens live 60 seconds and the frontend refreshes them
against Clerk. `verifyToken`, not `authenticateRequest` (that is for SSR
handshake redirects).

**2. `authorizedParties` is passed, derived from CDK.** It checks Clerk's `azp`
claim against `https://tanrenstrength.com` and `http://localhost:5173`, both
built from the one stack prop that holds the domain. It defends against a token
from *our* instance minted for another origin (subdomain cookie leaks,
satellites, previews) — real once a domain has several subdomains, which this
one does. Hardcoding the list in source drifts silently and 401s everything.

**3. Identity resolves with one indexed `SELECT`; the upsert runs only on a
miss; nothing about identity is cached.** Running `data-model.md`'s upsert on
every request would make each authenticated call a real `UPDATE` (`DO UPDATE`
writes a new tuple even when nothing changes). The select also returns
`sub_status`, so `requirePro` needs no second query. Caching
`clerk_user_id → id` was rejected: it saves a millisecond and turns a race or a
mis-keyed entry into a cross-tenant leak.

**4. The until-step-5 entitlement bypass is a constant, not a column value.**
`BILLING_NOT_LIVE = true` in `apps/api/src/auth.ts`; `sub_status` keeps its true
pre-Stripe value, `'NONE'`. Defaulting the column to `'ACTIVE'` or `'TRIALING'`
would fill a Stripe cache with values no subscription backs, which step 5's
webhook could never reconcile. Not an env var: scaffolding with a deletion date
should not look like a knob. `isPro` is the real rule, tested without the
bypass, with `PAST_DUE` pinned as not entitling.

**5. The custom domain landed in step 2, with Clerk's production instance from
day one.** A Clerk application carries a development *and* a production
instance; development stays permanently as the localhost instance, so the
decision was only that production exists now — otherwise every user created
before it would have been orphaned (new instance, new user ids). Keys are per
stage, like the database URL. Clerk application `tanren strength`,
`app_3KA3b5gVTRR1hOgmTvWtG0HSj9f` (non-secret; written here because the
dashboard is otherwise its only record). Everything is CDK — certificate stack
in `us-east-1`, alias, site records, Clerk's five CNAMEs — except **registering
the domain itself**, a console purchase CloudFormation cannot make (the second
recorded exception to "everything is CDK except Neon"). Registration created
the hosted zone, so stacks reference it by id (`fromHostedZoneAttributes`),
never `new HostedZone` (two zones, one delegated, reads as slow propagation) and
never `fromLookup` (synth would need live credentials).

**6. One schema file.** `packages/db/src/schema.ts`, as root `CLAUDE.md` says.
Splitting invites runtime import cycles (`planned_exercises` ↔ `workouts` ↔
step 3's session tables) for a file that exists to be read in one go.

**7. What Drizzle cannot express goes in a `--custom` migration, and each such
construct has an integration test.** The phase-2 spike (drizzle-orm 0.45.3,
drizzle-kit 0.31.11, Postgres 18.6) found only the two
`DEFERRABLE INITIALLY DEFERRED` position uniques need it; enums, the three
partial uniques, the generated `target_weight_kg` and the `num_nonnulls` check
all generate. The uniques are declared plain in `schema.ts` and recreated
deferrable in `0001` (drop-and-add: `ALTER CONSTRAINT … DEFERRABLE` still
rejects non-FK constraints in Postgres 18). drizzle-kit cannot see custom SQL,
so changing either constraint's columns regenerates it *without* `DEFERRABLE`;
`test/schema.test.ts` asserts `pg_constraint.condeferrable` so that fails loudly.
Postgres prints the generated column back with an `ELSE NULL` it adds itself —
semantically the no-`ELSE` form; do not "fix" the schema to match.

**8. The catalog is an idempotent seed over a TypeScript data file, run from
CI only.** Content churns (names, metrics) at a different rhythm from schema;
`INSERT`s in migrations would bury schema history and invite editing an applied
migration to fix a typo. The seed runs after every migration and writes nothing
when nothing changed. Removing an entry does not remove the row (retire with
`isActive: false`); removing a metric deletes it, scoped to listed exercises.

**9. Step 2 ships scoping *primitives*, not a query surface.** It had no
user-scoped domain queries to design against. What is a fact of the schema
shipped: each table's path to its owner (`userScope`), the write-side parent
check (`assertOwned`), and the exercise-visibility rule `data-model.md` §3.6
leaves out of the schema (`assertExercisesUsable`). Step 3 builds queries on
them. Row-level security was considered and not chosen: it needs `SET LOCAL`
in an explicit transaction per query under PgBouncer, a separate role and
`EXISTS` policies for the deep chains, and it appears nowhere in `docs/`. It is
additive on top of the primitives, so no door is closed.

**10. CI reaches AWS by GitHub OIDC with two roles; GitHub holds no secrets.**
The test role (pull requests and `main`) reads the Neon API key and the `dev`
direct string; the migrate role (`main` only) reads the `production` direct
string, so no pull request can. Trust policies match `sub` exactly
(`StringEquals`, no wildcards), in the repository's **immutable** subject form,
`repo:NoobChase@98501255/workout-tracker-mono-repo@1350890986:…`, which pins
owner and repo ids against a renamed or re-created namesake. Neither role can
deploy; deploys stay on a laptop.

**11. Lint is type-aware.** `recommended-type-checked` with `projectService`,
for `no-floating-promises` and `no-misused-promises` above all — a dropped
`await` on a transaction is a silent data bug. Not `strict-type-checked` (noise
that gets linters turned off); no stylistic rules (Prettier owns formatting).
Biome rejected: no type-aware rules.

**12. No router yet, and one `apiFetch` from day one.** The step-2 UI is a
sign-in button and an account check; a router belongs with step 3's real
screens. `apiFetch` is the only code that sets `Authorization`, using Clerk's
standalone `getToken`, so step 3's offline queue wraps it instead of growing a
second auth path.

**13. Apex canonical, `www` 301s to it, wildcard certificate.** The canonical
origin is close to a one-way door for a PWA (service-worker scope and installed
apps bind to it). The wildcard covers any future `dev.`/`staging.` with no
certificate change. The redirect lives in the existing viewer-request CloudFront
Function (`infra/lib/edge/viewer-request.js`, unit-tested from that exact file),
which also guards `/api/*` out of the SPA rewrite.

**14. The API is reached through CloudFront by a secret header, not origin
access control.** Reverses step 1. The first deploy of the auth path showed OAC
in front of a Function URL breaks two things a `GET`-only step 1 never
exercised: OAC signs the origin request by writing **its own `Authorization`
header**, overwriting the viewer's Bearer token; and Lambda refuses a signed
request whose body is not hashed in `x-amz-content-sha256`, so every POST with
a body — Clerk's webhook, later Stripe and MCP clients — got a bare AWS 403. The
Function URL is `AuthType: NONE`; CloudFront sends a CDK-generated Secrets
Manager secret as the `x-origin-verify` origin header (CloudFormation resolves
it at deploy, so the template never holds it; CloudFront overwrites a viewer
header of that name); `apps/api/src/origin.ts` refuses anything without it,
before any route. Rejected: keeping OAC with a custom token header and
client-side body hashing (fixes only our frontend), Lambda@Edge rewriting
headers (cost, latency, 1 MB body cap), API Gateway (public too, so the same
secret, plus a per-request charge). Accepted cost: a shared secret instead of
IAM, rotated by hand.

## Failures worth remembering

- **The OAC false pass.** After the first auth deploy, a forged token through
  CloudFront got the expected 401 — for the wrong reason: the token never
  reached the code (decision 14). The tell was the log: no "session token
  rejected" line, a 3 ms invocation. Check *why* a request was refused, not
  only that it was.
- **The first CI run failed at `AssumeRoleWithWebIdentity`.** The repository
  issues immutable OIDC subject claims, and the trust policy expected the old
  `repo:owner/name` form. `gh api repos/{owner}/{repo}/actions/oidc/customization/sub`
  shows which form a repository uses.
- **A hollow concurrency test.** Eight `resolveUser` calls fired with
  `Promise.all` never raced — each opened its own Neon WebSocket and setup
  serialised them — so a `DO NOTHING` bug passed. The test now forces the
  interleaving with an open transaction; mutating to `DO NOTHING` fails it.
- **`verifyToken`'s return shape.** The internal function returns
  `{ data } | { errors }`; the one exported from `@clerk/backend` is wrapped to
  throw on failure and return the payload. Read the export, not the source file.
- **drizzle-kit needs a TTY for apparent renames.** Dropping one column and
  adding another on the same table makes `generate` ask "rename?" and fail
  non-interactively. Split the schema edit and generate twice (`0002`, `0003`).
- **`cdk deploy` and `gh pr merge` can be blocked for the agent** by Claude
  Code's permission classifier; the user runs them with `!`. A `!` command has
  no TTY, so CDK's approval prompt aborts without
  `--require-approval never` — review the `cdk diff` first.

## Deliberately not done

- **Session tables** (`data-model.md` §3.6) and the "set that counts" predicate
  over them — step 3.
- **A query surface over the scoping primitives** — step 3, against real
  queries.
- **The purge job.** `user.deleted` stamps `deleted_at`; nothing hard-deletes.
  The first purge is not due until 2027-04 (six months after the first possible
  deletion), and a job with no rows to act on is untested code.
- **`processed_stripe_events`** — no writer until step 5.
- **Custom-exercise and per-exercise-settings operations.** The tables exist.
- **A `user.updated` webhook or any mirrored Clerk profile field** — §2.6.
- **A frontend router** (decision 12) — step 3.
- **CI deploys.** CI migrates and seeds; deploys run from a laptop.
- **Gating production migrations behind a GitHub Environment** — right once
  there are users (it also needs an `environment:` subject on the migrate
  role's trust policy); friction before.
- **Row-level security** (decision 9) — additive, not ruled out.
- **Narrowing the CDK bootstrap execution policy** (still
  `AdministratorAccess`, from step 1).

## Verification

Run during the step, 2026-10-17 to 2026-10-25.

| Check | Result |
|---|---|
| Typecheck, type-aware lint, Prettier | clean across all workspaces |
| Scoping primitives, real Neon branch (`test/scope.test.ts`) | 20 tests pass: user B's `planned_set` unreachable through A's scope; every owned table returns A's row and never B's; `UPDATE`/`DELETE` through A's scope leave B's rows untouched; `assertOwned` per table, naming only the failing ids; `assertExercisesUsable` refuses B's private exercise. Three mutations (unscoped `planned_sets`, unscoped plan level, permissive `visibleExercises`) each fail exactly their table's tests |
| Identity under concurrency (`test/users.test.ts`) | Forced race: the loser's insert blocks on the winner's open transaction and resolves to the winner's row; one row. Mutating `DO UPDATE` → `DO NOTHING` fails it. A returning user's request leaves `xmin` unchanged |
| `user.deleted` soft delete | Stamps once; a redelivery keeps the first `deleted_at` and writes nothing; an unknown user is a no-op |
| Seed (`test/seed.test.ts`, CLI) | Second run writes nothing (unchanged `xmin`, zero counts); edits apply exactly; a removed metric deletes only that row; an unlisted exercise keeps its metrics; refuses an empty catalog and a user-owned id. Mutations removing the no-op guard or the delete's scoping each fail. CLI on a throwaway branch: 92 exercises / 277 metrics, then a second run with zero changes |
| Custom-migration constructs (`test/schema.test.ts`) | Both position uniques `condeferrable = true, condeferred = true`; a single-statement position swap succeeds; a real duplicate is still rejected |
| `isPro` | All five `sub_status` values; `PAST_DUE` not entitling |
| API (`apps/api/test`) | 18 tests: CloudFront origin check (missing, wrong, valid-token-but-no-header, right secret), `requireAuth`, exact-path public list, `requirePro` with and without the bypass, webhook through the real `verifyWebhook` (valid, wrong secret, tampered body, ignored event type) |
| Infra (`infra/lib/*.test.ts`) | 28 tests, including the exact SSM grant list, no lambda-type OAC, the origin header as a Secrets Manager reference, and OIDC subjects matched exactly |
| Through CloudFront on `tanrenstrength.com` | `/api/hello` 200; `/api/me` without a token 401; a forged token 401 with the log showing Clerk JWKS lookup rejecting its `kid`; an unsigned webhook 400 from the handler; a caller-supplied `x-origin-verify` overwritten by CloudFront (reaches auth, 401); the bare Function URL 403 |
| Real sign-in, production Clerk instance | Signed up on `tanrenstrength.com`; "Your account" showed the internal user id and `NONE`; no token rejections in the Lambda log; exactly one `users` row confirmed in the Neon console |
| Migrations and seed via CI | Merge of PR #1 applied `0000`–`0001` to `dev` then `production`; merge of PR #2 applied `0002`–`0003` and seeded 92 exercises / 277 metrics in each |
| **Not verified** | A real `user.deleted` delivery from Clerk (the dashboard's webhook Testing tab); reloading after sign-in and re-checking that `xmin` on the `users` row is unchanged |
