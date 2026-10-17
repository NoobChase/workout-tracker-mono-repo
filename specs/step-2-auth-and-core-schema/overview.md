# Step 2 — Auth and core schema

> **Status: SPEC — written 2026-09-20, before implementation.**
>
> Specs govern before implementation; code governs after. Archive this to
> `specs/shipped/` the moment step 2 lands, cutting everything then derivable
> from the code.

**Goal:** a request arrives with a Clerk token, is verified without a per-request
network call, and resolves to a row in `users` — with the plan-side tables
migrated from CI and the standard exercise catalog seeded at fixed ids, served
from `tanrenstrength.com`.

Met when all of these are true:

- A signed-out browser cannot reach an authenticated route; a signed-in one can.
- Signing in creates exactly **one** `users` row on the first request and none
  on subsequent ones.
- `requirePro` exists, gates at least one route, and reads `users.sub_status`.
- `users` plus the eight plan-side tables exist in `dev` **and** `production`,
  applied by CI, never from a laptop.
- The catalog is present in both, with identical ids.
- The app is served from `tanrenstrength.com` over HTTPS, with Clerk running as
  a production instance against it.

## What this changes, by workspace

**`packages/db`** — stops being a placeholder. `schema.ts`, `drizzle.config.ts`,
generated migrations (plus any `--custom` ones the phase-2 spike proves
necessary), the user-scoping primitives, the catalog data file and its seed
script. This is the change that makes the root `CLAUDE.md` rule bite: the DDL
blocks in `docs/data-model.md` §3 and the whole of `docs/schema.dbml` are
**deleted in the same commit** that lands the Drizzle schema. The reasoning prose
in `data-model.md` stays.

**`apps/api`** — `requireAuth` and `requirePro` middleware, token verification
against a cached JWKS, select-first identity resolution, and
`POST /api/webhooks/clerk` (unauthenticated, signature-verified) handling
`user.deleted`. Gets its own nested `CLAUDE.md`.

**`apps/web`** — `ClerkProvider`, a sign-in control, and one `apiFetch` wrapper
that owns the `Authorization` header.

**`infra`** — the custom domain (decision 5): a Route 53 hosted zone, an
`us-east-1` certificate stack reached through `crossRegionReferences`, a
CloudFront alias, and Clerk's DNS records. Plus SSM parameters for the Clerk
secret key, the Clerk webhook signing secret and the Neon API key, with reads
granted to the Lambda and to CI; and a GitHub OIDC provider with the two roles
of decision 10.

**`.github`** — the repository's first CI. Typecheck, lint and test on PR;
migrate and seed on merge to `main`.

**root** — `npm run lint` stops being a no-op; Prettier added.

## Decisions made here

These are the ones not derivable from `docs/`. Everything in `data-model.md` §7
is settled and is not reopened below.

**1. Verify with `@clerk/backend`'s `verifyToken`, against a JWKS fetched once
per execution environment — not against a pinned PEM.** Clerk supports fully
networkless verification if you hand it the public key directly (`jwtKey`), and
the build plan's wording ("verify offline against Clerk's public key") reads
literally as that. Decided otherwise, deliberately: the cached-JWKS form
satisfies what that sentence was actually aimed at — never calling Clerk on the
request path — at a cost of one HTTP request per cold start, and it survives a
signing-key rotation with no manual step. A pinned PEM makes rotation a
coordinated hand-edit of an SSM parameter, and getting it wrong rejects every
token.

The one thing a pinned PEM genuinely buys — independence from Clerk's
availability — does not survive contact with the facts: **Clerk session tokens
live 60 seconds** and the frontend SDK refreshes them against Clerk's API, so a
Clerk outage locks every user out within a minute whatever the API does. The
JWKS promise is memoised at module scope, the same shape as
`apps/api/src/db.ts`.

Use `verifyToken`, **not** `authenticateRequest` — the latter exists for SSR
apps doing handshake redirects and is the wrong shape for a pure API.

**2. Pass `authorizedParties`, with the value derived from CDK.** Clerk stamps
an `azp` claim recording which origin a token was minted for; omit the option and
the claim is never checked. It does **not** defend against tokens from another
Clerk instance — those fail signature verification anyway. What it defends
against is a token from *our own* instance minted for a different origin: the
subdomain cookie-leaking attack, satellite domains, preview deployments.

That attack is not reachable today — the frontend is a `*.cloudfront.net` name
and `cloudfront.net` is on the Public Suffix List, so no other distribution can
be given a cookie for ours. The reason
to do it now is that it costs one line and, done this way, cannot rot: the stack
already knows the site's domain and passes `https://tanrenstrength.com` into the
Lambda's environment from that one stack prop, with `http://localhost:5173` added for local work. Decision 5 lands
the custom domain in this step, so the check guards a domain we actually own
from the day it is written — the subdomain attack it defends against is real
the moment that domain has more than one subdomain. Hardcoding the list in source is
the version worth avoiding — it drifts silently from infrastructure, and a stale
allowlist 401s every request, which presents as "auth is broken" rather than
"one value is stale".

**3. Identity resolves through one indexed `SELECT` per request; the upsert
fires only on a miss. Nothing about identity is cached.** `data-model.md` §3.2
prescribes running its JIT upsert on every request, and that statement does not
survive scrutiny as written: `ON CONFLICT DO UPDATE` on a hit performs a real
UPDATE — a new row version, a dead tuple, WAL, vacuum pressure — on the hottest
small table in the database, on every authenticated request, to accomplish
nothing. (The `DO UPDATE` is not gratuitous: `DO NOTHING` returns no row on
conflict, so `RETURNING` would come back empty on exactly the common path. The
provisioning *reasoning* in §3.2 is right; running its statement unconditionally
is not.)

Instead:

```sql
SELECT id, sub_status, deleted_at FROM users WHERE clerk_user_id = $1;
```

— an index-only hit on the existing unique index, resolving identity **and**
entitlement in one round trip, so `requirePro` needs no second query and still
reads a fresh `sub_status` on every request. The §3.2 upsert runs only when that
comes back empty, which is once in a user's lifetime. `deleted_at` is checked as
defence in depth; §4 is right that a soft-deleted user cannot authenticate, and
it costs nothing to not depend on that.

**Rejected: caching the `clerk_user_id → id` mapping at module scope.** It saves
one indexed read on a warm pool — low single-digit milliseconds, on a request
about to do real database work anyway — and in exchange makes identity
resolution a cache, where a mis-keyed entry or a race is a cross-tenant leak.
That is the precise failure §3.2 spends a paragraph on the legacy backend
committing. Not a trade worth making for a millisecond; revisit only if
profiling ever says otherwise, behind the same function.

**`docs/data-model.md` §3.2's SQL block must be updated when this lands** — the
prose stays, the statement changes.

**4. The until-step-5 entitlement bypass is a constant in the middleware, not a
column value.** `users.sub_status` keeps the `'NONE'` default §3.2 specifies.

The alternatives — defaulting the column to `'ACTIVE'`, or writing `'TRIALING'`
in the JIT insert — both put a value into `sub_status` that **no Stripe
subscription backs**. §3.8 defines those columns as a cache of Stripe's state;
filling the cache with fiction leaves step 5's webhook handler unable to
reconcile it, because it only writes in response to events and there will never
be an event for those rows. `'TRIALING'` with a `NULL` `sub_current_period_end`
is the worst version: an indefinite trial held by every early user, fixable only
by a data cleanup somebody has to remember. Pre-Stripe, `'NONE'` is the *true*
value; the bypass is a fact about the application, not about the user.

It also keeps step 5 cheap: deleting a constant, rather than a migration plus a
judgement call about existing rows. Grandfathering early users, if wanted, then
becomes a deliberate `UPDATE` rather than an inherited default.

Not an env var: this is scaffolding with a known deletion date, and making it
configurable implies a knob that outlives it. (If it ever becomes one, write it
as `=== 'true'` so an unset variable fails **closed**.)

Implemented as two pieces, so the real rule is tested from day one:

```ts
// pure, fully tested, no bypass -- this is the real rule
export const isPro = (s: SubStatus) => s === 'TRIALING' || s === 'ACTIVE';

// middleware, where the temporary lie lives
const BILLING_NOT_LIVE = true; // DELETE IN STEP 5
```

`PAST_DUE` not entitling, while being distinct from `CANCELED` (§3.8), is
exactly the rule that gets re-derived wrongly later unless a test pins it now.

**5. The custom domain lands in this step, and Clerk runs as a *production*
instance from day one.** Step 1 deferred the domain; step 2 un-defers it, because
auth is the thing that most depends on it. Reversed after deliberation — the
first draft of this spec shipped a Clerk development instance and scheduled the
swap for later.

**Correction to how this was first written.** The original framing — dev
instance now, swap to production later — was a false choice. A Clerk application
carries a development **and** a production instance simultaneously, with separate
keys and separate user pools. The development instance is what makes `localhost`
work at all, since a production instance only answers for its configured domain,
so it is not something to be swapped away from; it stays, permanently, as the
local-development instance. What decision 5 actually settles is that the
**production instance exists from step 2** rather than being stood up later.

Consequences that follow from both existing, and that the implementation has to
respect:

- **Clerk keys are per-stage, like the database URL.** The API reads
  `/workout-tracker/<stage>/clerk-secret-key`; the web build takes the matching
  publishable key. Mixing them across stages fails verification, since the two
  instances sign with different keys.
- The Clerk application is **`tanren strength`**, id
  `app_3KA3b5gVTRR1hOgmTvWtG0HSj9f` — a non-secret identifier, recorded here
  because both instances hang off it and the dashboard is otherwise the only
  place it is written down.
- **A locally created user is not a production user.** Local development points
  at the Neon `dev` branch, so dev-instance `clerk_user_id`s land in the dev
  database and production-instance ids in production. That separation is the
  existing setup, not new work — but running local dev against the production
  database would write dev-instance ids into it, which is a reason not to.
- `authorizedParties` therefore carries the apex **and** `http://localhost:5173`
  (decision 2), because both instances are legitimately in use.

Why production now rather than later:

- Had production been deferred, every `users` row created against the
  development instance in the meantime would have been orphaned when it landed —
  different ids, exactly as §4 describes for re-signup, applied to the whole
  table at once.
- Clerk relaxes security on development instances (notably shared OAuth
  credentials for social sign-in), so the production configuration would never
  be exercised until the day it had to be.
- Standing up production later is a change to the authentication system, and
  every candidate date for it is a bad one.
- Decision 2's `azp` check is theoretical without a domain and load-bearing with
  one.

Accepted cost: a second CDK stack in `us-east-1` for the ACM certificate plus
`crossRegionReferences` on the main stack — the work `infra/bin/infra.ts`
already carries a comment about — a CloudFront alias, and DNS for three separate
things: ACM validation, the site records pointing at CloudFront, and Clerk's own
records (Frontend API, accounts portal, and email DKIM/return-path). **All of
that is CDK.** DNS living in Route 53 in the same account is what makes it true;
with external DNS these would be hand-entered records that drift, and that would
have been a reason to reconsider.

**The one exception: registering the domain itself is a console action, and that
is deliberate.** `CLAUDE.md` says everything is CDK except Neon; this is the
second exception and it should be recorded rather than look like sloppiness.
Registration is a purchase — payment method, ICANN contact details, email
verification — and CloudFormation has no resource that performs it.
(`AWS::Route53Domains::RegisteredDomain` manages settings on a domain already
registered in the account; it cannot buy one.) Everything downstream of the
purchase stays in CDK.

**Consequence that must not be missed: registering through Route 53 creates the
public hosted zone for you.** So the stacks **reference the existing zone** and
never `new HostedZone`. Creating a second zone for
the same name yields two zones with different NS record sets, the registrar
delegates to only one of them, and nothing resolves; worse, it looks like a
propagation delay rather than a mistake. Both stacks need the zone: the
`us-east-1` certificate stack for DNS validation
(`CertificateValidation.fromDns(zone)`), and the `us-east-2` stack for the alias
and Clerk records.

Referenced by **`fromHostedZoneAttributes`, with the zone id as a stack prop** —
not `fromLookup`. `fromLookup` performs a context lookup needing live AWS
credentials at synth time, which would make `cdk synth`, the infra tests, and any
future CI synth depend on an SSO session; it also silently substitutes a dummy
zone when the lookup cannot run. The zone id is not a secret, and it is stable:
the zone was created once with the registration and is never recreated. Hermetic
synth is worth more than avoiding one literal.

**The domain is `tanrenstrength.com`**, registered 2026-10-01 through Route 53 in
the `workout-tracker` account. It enters as one stack prop and is referenced from
there everywhere else — CloudFront alias, ACM subject, Clerk records,
`authorizedParties` — so it is written down exactly once in `infra/bin/infra.ts`.

Subdomains this commits to: the apex and `www` for the site (decision 13),
`accounts.` for Clerk's portal, and Clerk's own Frontend API and email records. Worth knowing
that this is precisely why decision 2's `azp` check is not theoretical — there
are now several names under one registrable domain.

Ordering consequence: ACM validation and Clerk's DNS propagation are wall-clock
waits rather than work, so they go at the very front (`plan.md` phase 0) and
settle while the schema work proceeds.

**6. One schema file: `packages/db/src/schema.ts`.** Root `CLAUDE.md` says "the
Drizzle schema **file**", singular, and there is no reason to reinterpret it. The
first draft of this spec proposed a `src/schema/` directory split by area;
reversed.

The case for splitting is that it will grow, and here we know it will not:
`docs/data-model.md` specifies the whole schema and §7 settles it. Nine tables
now, twelve after step 3's session tables, thirteen once
`processed_stripe_events` lands in step 5, plus seven enums — a normal single
file.

Against splitting, once growth is off the table: `planned_exercises` references
both `exercises` and `workouts`, and step 3's `session_exercises` references
`planned_exercises` and `exercises`, which is exactly the shape that produces
import cycles across modules — failing at runtime as an `undefined` table rather
than as a type error. And this file exists to be *read*: deleting the DDL from
`data-model.md` and `schema.dbml` is only worth doing if what replaces them is
one `Read`, not a barrel re-exporting four modules.

Splitting later is mechanical and changes no import path, so starting single
costs nothing if it turns out to be wrong.

Migrations live in `packages/db/migrations/`, with `drizzle.config.ts` pointed
at both.

**7. Constructs Drizzle cannot express go in a `--custom` migration, and each one
is asserted by an integration test.** `DEFERRABLE INITIALLY DEFERRED` on the two
position uniques is the expected gap; the partial indexes, the generated
`target_weight_kg` column and the `num_nonnulls` check may or may not be. Phase 2
of `plan.md` establishes which, rather than assuming.

**Phase-2 result (2026-10-17, drizzle-orm 0.45.3 / drizzle-kit 0.31.11, Neon
Postgres 18.6).** Only the two deferrable uniques need `--custom`. Generated, applied
to a throwaway branch, and checked by behaviour, not just by reading the SQL:

| Construct | Drizzle form | Result |
|---|---|---|
| Seven enums | `pgEnum` | generates |
| Three partial uniques, incl. `lower(name)` | `uniqueIndex().on(sql…).where(sql…)` | generates; case-folded duplicate rejected |
| `target_weight_kg` | `numeric().generatedAlwaysAs(sql…)` | generates; LB → 45.3592, KG → 100, `NULL` unit → `NULL` |
| `num_nonnulls(…) = 1` | `check()` | generates; both-null row rejected |
| Two `DEFERRABLE INITIALLY DEFERRED` uniques | no API | **`--custom`**; single-statement position swap succeeds |

A second `generate` with no schema change is a no-op, so none of the expression
forms drift. Postgres prints the generation expression back with an
`ELSE NULL` it adds itself; that is the no-`ELSE` form, semantically identical — do
not "fix" the schema to match it.

**How the custom migration is shaped — settled by the spike.** `schema.ts`
declares each position unique as a plain `unique("<name>")` with an explicit
name, and the `--custom` migration that follows drops and re-adds it under the
same name with `DEFERRABLE INITIALLY DEFERRED`. Drop-and-add, because
`ALTER CONSTRAINT … DEFERRABLE` still rejects non-foreign-key constraints on
Postgres 18. Declaring the constraint (rather than leaving it out of `schema.ts`
and creating it only in custom SQL) because the spike showed what each choice
costs:

- An unrelated change to the same table (adding a column) leaves the constraint
  alone. Both approaches are safe there.
- Changing the declared constraint's columns makes `generate` emit a drop and a
  re-add **without** `DEFERRABLE` — the silent loss described below, confirmed.
  The fix is a `--custom` migration straight after it, and the test catches a
  forgotten one.
- Leaving the constraint out of `schema.ts` means the file a reader trusts shows
  no uniqueness on `position` at all, and a later attempt to "add the missing
  unique" collides with the existing name. That is the bigger dent in "the schema
  file is the source of truth", for no protection the test does not already give.

Not up for debate: whether to simply avoid the constructs. Dropping `DEFERRABLE`
and reordering with a two-phase offset would keep `schema.ts` a complete
description of the database, but `data-model.md` §7 entry #1 settles that
"partial unique indexes, **deferrable constraints**, and `num_nonnulls` stay
database guarantees rather than app conventions", and §7 entries are not
relitigated. (It would not be free regardless — a single-statement position swap
still fails, because Postgres checks index-backed uniqueness per row as the
statement progresses.)

`drizzle-kit generate --custom` emits an intentionally empty migration for
hand-written SQL. That is the sanctioned path and is **not** the forbidden act of
rewriting SQL that `generate` produced.

Its real cost, stated plainly: **custom SQL is invisible to drizzle-kit's
differ.** It diffs `schema.ts` against its own snapshots, so the clause exists in
the database but not in the snapshot. That means it is never reverted — and also
that `schema.ts` is not a complete description of the database, a genuine dent in
"the schema file is the source of truth". Worse, a future migration that alters
one of those tables could have drizzle-kit drop and recreate the constraint
*without* the clause, silently.

So each gap gets an assertion against a real Neon branch rather than a comment:

```sql
SELECT condeferrable, condeferred FROM pg_constraint WHERE conname = $1;
```

A comment decays. A test fails the day a regeneration drops the clause — instead
of that surfacing during step 4's reordering work as a baffling constraint
violation.

**8. The catalog is an idempotent seed script over a TypeScript data file, not
`INSERT`s in a migration — and the script runs from CI only, exactly like a
migration.** That second clause is a rule, not a description: a seed script is a
second thing that mutates the database, so without it this decision reopens the
ad-hoc-laptop-mutation path `CLAUDE.md` closes for migrations.

The catalog is **content**, and content has a different edit rhythm than schema.
The build plan budgets an afternoon for it, which is an afternoon of iterating on
names, equipment and metric sets; under the migration approach every pass is
another migration file, and within a month the migration directory is mostly
catalog churn with the schema history buried in it. A migration full of `INSERT`s
is also not reviewable *as content*, which is the thing being edited. And the
friction of "this typo needs a whole new migration" is exactly what eventually
produces someone quietly editing an applied one — the failure the rule exists to
prevent.

The honest case against: migrations are one mechanism rather than two, they
cannot let dev and production diverge, and they give content changes a real
changelog. Accepted, and outweighed.

Mechanics that must be right:

- **Upsert is not enough for metrics.** `ON CONFLICT (id) DO UPDATE` never
  removes anything, so dropping a metric from an exercise in the file would
  silently do nothing. For each exercise *present in the file*, delete the
  `exercise_metrics` rows outside its declared set. Scoping that delete to
  exercises in the file is the part to get right; unscoped, it wipes metrics for
  everything the file does not mention.
- **Ids are generated once and frozen** — UUIDv7, minted when the entry is
  authored, pasted in as a literal, never regenerated. That stability is the
  whole point of §3.3.
- Runs on every deploy. It is ~80 upserts and idempotent, so "only when the file
  changed" is a complication with no payoff.

Consequence, accepted: **removing an entry from the file does not remove the
row.** That is correct — `exercises` is `ON DELETE RESTRICT` from planned and
session rows, and the documented retirement path is `is_active = FALSE`, a field
in the data file. (Migrations share this property; they do not un-insert either.)

**9. Step 2 ships the scoping *primitives*, not a query surface.** Narrowed from
the first draft, which said "the helper, covering the plan side" — written before
checking whether step 2 has anything to scope. It does not: its only queries are
resolving identity by `clerk_user_id`, the JIT upsert, the webhook soft-delete,
and seeding standard exercises (`owner_user_id IS NULL`). None is a user-scoped
domain query, and designing a repository façade against zero call sites is how
the wrong abstraction gets built and then discovered in step 3.

What *is* safe to build now is the part that is a fact of the schema rather than
a guess about queries: for each user-owned table, its path to a `user_id`. "A
`planned_set` belongs to the user who owns its program, via
`planned_exercises → workouts → workout_plans → workout_programs`" is derivable
from `data-model.md` today and will be equally true in step 3. That chain, and
the cross-tenant invariants the schema deliberately leaves open — nothing stops a
`user_exercise_settings` row or a `planned_exercise` from pointing at another
user's private exercise — are what the primitives own. Step 3 builds the query
surface on top.

With no production call sites, **the integration test is the call site**: two
users' data on a real Neon branch, asserting user B's `planned_set` is
unreachable through user A's scope. That is worth more than a façade would have
been.

**Considered and not chosen: Postgres row-level security.** It is the strongest
answer to "the legacy backend had no authorization" — the database enforces it
and no helper can be forgotten. It also requires every query to run inside an
explicit transaction with `SET LOCAL` under PgBouncer transaction-mode pooling
(three or four round trips where there was one), a separate non-owner application
role, and `EXISTS` policies for the deep chains. More to the point, it appears
nowhere in `docs/` and `CLAUDE.md` has already specified an application-layer
helper; adopting it here relitigates that by the back door. It is **additive** —
it layers on top of the primitives later without removing them — so this choice
closes no doors.

**"A set that counts" is not written in step 2.** It is defined over
`session_sets`, which do not exist until step 3, and writing it against nothing
is how it gets written wrong.

**10. CI authenticates to AWS by GitHub OIDC, with two roles — and GitHub holds
no secrets at all.** The alternative, connection strings as GitHub Actions
secrets, duplicates a rotatable credential into a second store that drifts: Neon
rotates or a branch is recreated, SSM and GitHub disagree, and the failure is
either a migration against a stale database or a confusing auth error. The
`neon-branch` skill already makes SSM the single place these strings live.

It does not even buy simplicity. The Neon API key needed for ephemeral test
branches is not an AWS credential, so under that approach it must be a GitHub
secret regardless — the result is secrets in two places rather than no AWS setup.
Under OIDC the **Neon API key goes into SSM too**, and GitHub holds only a role
ARN, which is not a secret.

Two roles, because one role assumable from any branch lets any pull request read
the **production** direct connection string:

- a **test** role, assumable from pull requests — Neon API key and the `dev`
  direct string;
- a **migrate** role, assumable only from `refs/heads/main` — the production
  direct string.

Both scoped to `ssm:GetParameter` on exactly those parameter ARNs plus the
`kms:Decrypt` grant with the `kms:ViaService` condition the existing stack
already demonstrates for the Lambda. **Not** a broad deploy role: deploys stay on
the laptop in step 2, and widening this is a later deliberate change rather than
something pre-granted.

**As built (phase 4).** Two refinements, neither widening what a pull request
can reach. The test role is also assumable from `main`, because the merge
workflow migrates `dev` through it — `dev` follows what merged, rather than
whatever an open (or abandoned) pull request last applied. And there is one
workflow file, not two: `check` on every pull request and push, then
`migrate-dev` and `migrate-production` on `main` only, each `needs:` the one
before, so no migration reaches a database from a commit whose tests failed.
The trust policies match `sub` exactly (`StringEquals`, no wildcards), and
`infra/lib/ci-stack.test.ts` pins both that and the parameter scoping.

For later, not now: production migrations run automatically on merge to `main`,
which is right while there are no users. Once there are, production should become
a GitHub Environment with a required reviewer — real value then, pure friction
now.

**11. Lint stops being vacuous, with the *type-aware* rule set.** Step 1 left
`npm run lint` a no-op and called it an open decision; CI is being built here
anyway, and a no-op lint gate makes one clause of the definition of done true by
construction. ESLint flat config with `typescript-eslint`, plus Prettier.

Upgraded from the first draft, which said "recommended rules only" — close to
pointless, since that set is largely syntactic and `tsc` already catches most of
it. The rules that earn their place here are type-aware:

- **`no-floating-promises`** — a forgotten `await` on a transaction, a pool
  query, or an SSM read. This codebase is asynchronous end to end, and step 4's
  clone primitive reads a level then writes the next inside an interactive
  transaction. A dropped `await` there is a silent data bug no test reliably
  catches.
- **`no-misused-promises`** — an async function passed where a sync callback is
  expected; Hono middleware is the obvious site.
- `await-thenable`, `require-await`.

So: `recommended-type-checked`, with `projectService` enabled. Not
`strict-type-checked`, whose extras (`no-unnecessary-condition` and friends)
argue with defensive code and produce the kind of noise that gets a linter turned
off. No stylistic rules — Prettier owns formatting, and its value with an agent
writing most of the code is that diffs show what changed rather than how it
reflowed.

Rejected: **Biome**. Faster, one binary, formatter included — and no type-aware
rules, so it cannot catch a dropped `await`, which is the single thing most worth
catching here.

**12. No router yet — and one `apiFetch` wrapper from day one.**
`<SignedIn>` / `<SignedOut>` around the existing page, plus a `<UserButton>`, is
the whole of step 2's UI. A router with two routes in it is step 3's work done
early, against screens whose shape is not yet known, with no step 2 payoff.
Nothing is blocked by waiting: step 1's CloudFront function already rewrites
extensionless paths to `index.html`, so deep links work the day a router arrives,
and a post-sign-in redirect to a path that does not exist yet simply renders the
SPA.

The wrapper is not tidiness. `CLAUDE.md` requires offline writes to go through
the ordered, serial-per-session mutation queue, "never a bare fetch from the
logging UI". That queue lands in step 3 and needs the same token logic; if step 2
spreads `getToken()` across call sites, step 3 either re-implements auth inside
the queue or inherits two paths that can disagree about it. One wrapper now means
the queue wraps something that already exists.

**Deliberately left open: how sign-in is presented** — Clerk's modal, its hosted
account portal (at `accounts.<domain>` on a production instance), or an embedded
`<SignIn>`. That is an implementation detail against a component API that moves,
so it is confirmed against Clerk's current documentation at implementation time
rather than pinned here. The embedded path-routed form needs a router, so it
belongs with step 3 regardless.

**13. Apex canonical, `www` redirects to it, and the certificate carries a
wildcard.** Three sub-decisions under decision 5, settled for the long term
rather than for step 2.

**Certificate: `tanrenstrength.com` + `*.tanrenstrength.com`.** ACM public certs
are free whatever names they carry, and a wildcard needs no validation record
beyond the apex's — so `dev.`, `staging.` or anything else later needs **no
certificate change at all**. An apex-plus-`www` cert would make the first
staging subdomain a reissue plus a CloudFront update. (A wildcard does not cover
second-level names like `a.b.tanrenstrength.com`; nothing here wants one.)

**Canonical origin: the apex.** This is close to a one-way door for a PWA —
service-worker scope and an installed app's identity are bound to the origin, so
changing the canonical name later orphans every installed copy. Apex is shorter,
and Route 53 alias records removed the old technical objection to apex-at-a-CDN.

The real argument for `www`-canonical, recorded because it is not a bad one:
a cookie set on the apex is sent to **every** subdomain, Clerk's `accounts.`
included, whereas `www` keeps app cookies on one host — the isolation decision 2
compensates for. Rejected because Clerk's production model sets cookies on the
registrable domain anyway so its portal can share the session, so
`www`-canonical does not actually buy the isolation it appears to.

**`www` exists as a 301 only, never serving content.** One canonical origin keeps
`authorizedParties` a single entry and avoids two origins that can disagree about
auth. It is nearly free: step 1 already put a CloudFront Function on the
viewer-request path, so this is a branch in a function that exists rather than a
second distribution.

**Consequence: that function now does two things, either of which breaks
something important** — a bad rewrite breaks `/api/*`, a bad redirect breaks
auth. So it moves out of an inline string into `infra/lib/edge/viewer-request.js`
and gets unit tests that load that exact file. It is also attached to the
`/api/*` behaviour (so one origin is true for every path), which means the SPA
rewrite needs an explicit `/api/` guard — tested, because an unguarded rewrite
would turn every API call into `index.html`.

## Deliberately not done

- **Session tables** (`data-model.md` §3.6) and everything over them — step 3.
- **The query surface over the scoping primitives** (decision 9) — step 3, when
  there are real queries to design it against.
- **"A set that counts"** — defined over rows that do not exist yet.
- **The purge job.** `user.deleted` stamps `deleted_at` per §4; nothing hard
  deletes yet. A six-month window means the first purge is not due until
  2027-03, and a scheduled job with no rows to act on is untested code.
- **`processed_stripe_events`** (§3.8) — it has no writer until step 5.
- **Custom exercise creation, per-exercise settings UI.** The tables exist; the
  operations over them do not.
- **A `user.updated` webhook or any denormalized Clerk profile field** — §2.6
  forbids it by default.
- **A frontend router** (decision 12) — step 3.
- **CI deploys.** CI migrates and seeds; `npm run deploy` still runs from a
  laptop against the `workout-tracker` SSO profile. The OIDC roles are
  deliberately scoped too narrowly to deploy, so widening them is a visible
  decision rather than an inherited permission.
- **Gating production migrations behind a GitHub Environment** — correct once
  there are real users, friction before that (decision 10).
- **Row-level security** (decision 9) — additive on top of the primitives, not
  ruled out.
- **Narrowing the CDK bootstrap execution policy**, still `AdministratorAccess`,
  inherited from step 1.

## Verification

Filled in when the work lands, per the definition of done in `CLAUDE.md`.

Integration tests, against a real Neon branch — not optional here:

- **The scoping primitives**, including the negative case: two users' data, and
  user B's `planned_set` unreachable through user A's scope.
- **Identity resolution under concurrency** — two simultaneous first requests for
  one `clerk_user_id` must produce exactly one row.
- **The seed script run twice**, the second run a no-op, and a metrics removal in
  the data file actually removing the row.
- **Every construct the phase-2 spike routed through a `--custom` migration** —
  for the deferrable uniques, `SELECT condeferrable, condeferred FROM
  pg_constraint WHERE conname = $1` (decision 7).

Ordinary unit tests, no database:

- **`isPro`** across all five `sub_status` values, pinning `PAST_DUE` as
  not entitling (decision 4).

| Check | Result |
|---|---|
| _(to fill)_ | |
