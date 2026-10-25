# Workout tracker rewrite — build plan

## Stack summary

| Layer | Choice |
|---|---|
| Hosting | New AWS account, Paid Plan, region **`us-east-2`** (a future ACM cert for CloudFront will be the sole `us-east-1` exception) |
| Frontend | Vite + React + TypeScript + Tailwind + shadcn/ui, installable PWA |
| Frontend hosting | S3 (private) + CloudFront with OAC |
| API | TypeScript (Hono) on Lambda, **outside any VPC**, behind a Lambda Function URL reachable only through CloudFront, which proves itself with a secret origin header (no API Gateway — see step 1) |
| Database | **Neon** serverless PostgreSQL, WebSocket driver |
| ORM / migrations | Drizzle |
| Auth | Clerk |
| Payments | Stripe (US only, so no merchant-of-record needed) |
| Infrastructure | AWS CDK (plus Neon, which lives outside it — see step 1) |

The database choice is the one that shapes everything else. It is argued in
step 1; the short version is that Lambda-in-a-VPC talking to RDS costs about
$33/month in NAT charges or $15/month in VPC endpoints, needs an SSM tunnel for
every migration, needs reserved-concurrency tuning against a `t4g.micro`'s
connection ceiling, and blocks the Stripe integration in step 5. Moving the
database outside AWS removes all four problems at once.

---

## Repository layout

One repository, npm workspaces. Split repos would cost you the shared Zod
schemas between the API and the frontend, which was a large part of the reason
for staying with TypeScript.

```
workout-tracker/
  apps/
    web/          React app (PWA)
    api/          Hono on Lambda
    mcp/          added in step 6
  packages/
    shared/       Zod schemas, shared types
    db/           Drizzle schema + migrations
  infra/          CDK
  docs/
  specs/
```

Notes:

- `packages/db` rather than inside `apps/api`, because the MCP server will need
  database access too and should not import from a sibling app.
- Skip Turborepo until builds are actually slow. npm workspaces alone is enough
  at this size.
- Independent deploys are a CI path filter, not an architectural concern. If
  nothing under `apps/web` changed, skip the frontend job.
- **The Drizzle schema file is the source of truth, not the database.** Edit the
  schema, run `drizzle-kit generate`, commit the generated migration. Never edit
  a migration that has already been applied — generate a new one. This matters
  more with agents in the loop, since an agent asked to fix the schema will
  cheerfully rewrite an old migration rather than adding a new one.
- **When `packages/db` lands, delete the DDL from `docs/data-model.md` and
  `docs/schema.dbml`.** Until then there are three hand-maintained copies of one
  schema, which is two too many, and the stale ones are what an agent will read.
  `data-model.md` keeps the *reasoning*, which is the part that cannot be
  generated and does not rot.

## Working conventions

Spec-driven, with the specs kept deliberately light:

- **`CLAUDE.md` at the repo root**, under 100 lines, holding the rules that
  apply everywhere. Nested `CLAUDE.md` files per workspace for package-specific
  conventions. Everything in the root file is in every agent context for every
  task, so it competes with the actual work — keep it short.
- **`specs/<feature>/`** with overview, plan, and tasks, but only for features
  that touch the schema, the auth model, or more than one layer. Smaller changes
  skip the ceremony.
- **Specs govern before implementation; code governs after.** Archive or delete
  a spec once its feature ships. A stale spec fed to an agent six months from
  now will produce confident "fixes" to working code.
- **Define what "done" means once, in `CLAUDE.md`**, rather than per spec.
  Without it, agents mark tasks complete because they wrote code rather than
  because it works.
- **Generate schema documentation from the Drizzle schema** as a build step
  rather than hand-maintaining it. Hand-written schema docs are wrong within a
  month, and a stale one given to an agent is worse than none.

---

## Overview of the sequence

**Step 0 — Account and guardrails.** New AWS account on the Paid Plan, billing alerts, root locked down. No application code.

**Step 1 — Infrastructure skeleton.** CDK stack that stands up the whole pipe end to end with nothing meaningful in it: CloudFront serving a static page from its default `*.cloudfront.net` name, a Lambda behind a Function URL, an empty Neon database. No custom domain, no certificate (both landed in step 2). Small, because the expensive networking decisions have been designed out rather than solved.

**Step 2 — Auth and core schema.** Clerk wired into both the frontend and the API. The plan-side tables from `data-model.md`, plus the seeded exercise catalog. Nothing beyond that.

**Step 3 — Vertical slice.** Start a workout, log one set, see it in history — offline, then synced. All the way through every layer. This is the whole app in miniature and it is where the offline architecture gets built.

**Step 4 — Broaden.** Build out the rest of the API and UI against a schema you have now actually used. Includes the program **import/export format** — the universal bring-your-own-AI door, shipped before the MCP server and independent of it.

**Step 5 — Payments.** Stripe Checkout, Customer Portal, webhook handler, entitlement middleware.

**Step 6 — MCP server.** A thin adapter over the service layer you have been building since step 3.

The reason for this order: steps 0 through 3 are about de-risking, not features. Everything expensive to get wrong (schema shape, auth model, offline architecture) gets decided while the app is small enough to throw away. Note that payments are step 5 and not later: the business goal is paying users, and the entitlement columns exist from step 2 precisely so that the last step is wiring, not retrofitting.

---

## Step 0 — Account and guardrails

> **Status (September 2026).** Done: AWS account on the Paid Plan, region
> `us-east-2`, IAM Identity Center with user `chase` and CLI profile
> `workout-tracker`, the setup-era IAM user deleted, the root-only
> billing-access toggle, Neon project `super-bar-40420599` with `production`
> and `dev` branches, and all four SSM parameters. Concrete values are recorded
> in step 1.
>
> **Deferred by decision: root MFA and the $30 budget alert.** Both remain
> worth doing before the account holds paying customers — root MFA especially,
> since with no IAM users in the account, root is the only break-glass path
> there is.

**Goal:** an AWS account you can safely make mistakes in.

**What you do:**

- Create the account with a fresh email address you control, ideally an alias on your own domain rather than a personal address. This becomes the root identity and changing it later is painful.
- **Choose the Paid Plan, not the Free Plan.** The Free Plan closes your account when credits run out or after six months, then deletes resources after a grace period. Both plans get the same credits ($100 at signup, another $100 for completing onboarding tasks), so the Free Plan buys you nothing and adds a deletion timer.
- MFA on root, then never use root again. Create an IAM Identity Center user for daily work.
- Set an AWS Budget with an alert threshold around $30. Setting up a budget is one of the credit-earning onboarding tasks, so you get paid to do the thing you should do anyway.
- **Region: `us-east-2` (Ohio). Decided.** Everything lives there — Lambda, S3, the CloudFront origin, and the Neon project — with exactly one future exception, the ACM certificate discussed below, which is deferred out of step 1. Create the Neon project in AWS `us-east-2` so Lambda and Postgres are co-located; that hop is the only latency in the app that is worth caring about.
- Create the Neon project at the same time, and put its connection strings somewhere your CDK can read them. Neon has its own free tier and its own billing — that is a second bill to watch, not a second thing to forget.

**Watch out for:**

- **No custom domain in step 1 — decided, then superseded in step 2**, which landed `tanrenstrength.com` because Clerk's production instance needs it (`specs/shipped/step-2-auth-and-core-schema/overview.md`, decision 5). The original reasoning: the distribution's default `*.cloudfront.net` hostname already serves HTTPS with a CloudFront-managed certificate, which is everything a hello-world pipe needs. Skip the ACM certificate, the hosted zone, and the alias for now. Adding a domain later is an alias plus a certificate on an existing distribution, not a restructuring, so there is no reason to block step 1 on a DNS decision.
- **The custom domain's ACM certificate lives in `us-east-1`** even though everything else is `us-east-2`. CloudFront reads certificates only from `us-east-1`; one requested in Ohio is simply invisible to it and the failure mode is confusing. That means a second stack pinned to `us-east-1` holding just the certificate, referenced with `crossRegionReferences: true` — the only resource in the account outside `us-east-2`, so leave a comment in the CDK saying why.
- **The domain** was registered fresh through Route 53 in this account on 2026-10-01, which created its hosted zone; nothing was transferred from the old account.
- **Orphaned resources bill silently.** Unattached EBS volumes, unassociated Elastic IPs, and snapshots survive the deletion of the thing they belonged to. Check the billing console after any teardown.
- **The legacy RDS instance.** `legacy-overview.md` §0 lists live credentials committed to git history. If that instance is still running, rotate or destroy it now — this is independent of the rewrite and it is the only genuinely urgent item in this document.

---

## Step 1 — Infrastructure skeleton

**Goal:** hello-world flowing browser → CloudFront → Lambda Function URL → Neon → back, defined in CDK.

This step used to be the long one. It is short now, and the reason is worth understanding rather than just accepting.

**The decision that used to determine your bill.** Lambda reaching RDS means Lambda inside a VPC, and Lambda inside a VPC has no route to the internet unless you pay for it:

| Approach | Cost | What it drags in |
|---|---|---|
| NAT Gateway | ~$33/mo + data | Nothing else, but it more than doubles the baseline |
| VPC interface endpoints | ~$7.30/mo **each, per AZ** | One per AWS service you call; no third-party access at all |
| NAT instance on t4g.nano | a few dollars | A server you now patch, which is what you were escaping |

Plus RDS Proxy at ~$15/month to survive Lambda concurrency against a
`t4g.micro`'s connection ceiling, plus an SSM tunnel every time you run a
migration from your laptop, plus a hard block at step 5 because Stripe is a
third party and no VPC endpoint exists for it.

**Running the database outside AWS deletes that entire table.** The Lambda has
no VPC, so it has ordinary internet access: Neon works, Clerk's JWKS works,
Stripe works. There is no NAT, no endpoint, no proxy, no tunnel, and no
connection-limit arithmetic. Local development is a connection string.

The honest cost of that: a second vendor, and your users' training data lives in
Neon's account rather than yours. Their backup and PITR story is good, but it is
theirs. That is the trade, made deliberately.

**What you build:**

- A CDK app in TypeScript. One stack; split into network / data / app stacks later if it gets unwieldy.
- CloudFront + private S3 with Origin Access Control, and an `/api/*` behavior pointed at the Lambda's Function URL with `CachingDisabled` and `AllViewerExceptHostHeader`.
- A single Lambda running a Hono app, with a catch-all route, exposed via a **Function URL** — no API Gateway. With CloudFront in front, API Gateway added a resource, a per-request charge, and configuration surface while providing nothing this app uses (no usage plans, no API keys, no request validation — auth is Clerk middleware in Hono). Fewer moving parts wins; this is now decided rather than left open. One function, normal web framework, not one function per endpoint. **No VPC configuration at all** — this is the point of the whole step.
- **The Neon project exists.** Project id `super-bar-40420599`, AWS `us-east-2`, default branch **`production`**. Still to create: a `dev` branch off it. Branches are cheap and disposable, which is genuinely useful with agents in the loop — a branch per feature branch, thrown away on merge.
- **AWS access is Identity Center, not IAM users.** Local CLI profile **`workout-tracker`** (SSO session `workout-tracker-sso`, role `AdministratorAccess`, 8-hour sessions, region `us-east-2`). `aws sso login --profile workout-tracker` refreshes an expired session. There are deliberately **no IAM users and no long-lived access keys** — the one IAM user created during setup was deleted. Root is the break-glass path and nothing else. When CI needs AWS credentials it gets a GitHub OIDC role, never a key pair. The account id is intentionally not written down here; CDK resolves it from the profile at deploy time.
- **The connection strings live in SSM Parameter Store**, region `us-east-2`, stored as `SecureString` under the AWS-managed key (free on the standard tier — no `--key-id`, which would cost ~$1/mo for nothing):

  ```
  /workout-tracker/production/database-url-pooled   -> Lambda runtime
  /workout-tracker/production/database-url-direct   -> CI migrations
  /workout-tracker/dev/database-url-pooled          -> dev runtime
  /workout-tracker/dev/database-url-direct          -> dev migrations
  ```

  Pooled (`-pooler` hostname) is for the runtime; direct is for migrations, because PgBouncer in transaction mode breaks the session-level features migration tools rely on. Grant the Lambda's execution role `ssm:GetParameter` on **its single parameter**, never a wildcard over the path — the runtime has no business reading the direct or dev strings. Read it once at cold start into a module-level variable; never fetch per request.

**Watch out for:**

- **Use the WebSocket driver, not the HTTP one.** `@neondatabase/serverless`'s HTTP driver cannot do interactive transactions — only single statements and pre-batched ones. Several operations in `operations.md` read a level and then write the next using what they read: the clone primitive (§0.2), copy-program (§3.9), activate (§3.10), and finish-and-maybe-extend (§4.13). Choose the HTTP driver here and you discover the problem at step 4. Use the `Pool` from the serverless package, against the pooled (`-pooler`) endpoint.
- **Create the pool outside the handler** so it is reused across invocations, and never call `pool.end()` per request.
- **Autosuspend.** Neon's free tier suspends compute after inactivity and takes roughly half a second to wake. For an app opened twice a day that is on every first request of the day. Either accept it or budget for the tier that keeps it warm — this is a real user-facing latency decision, not a footnote.
- **Neon is not in your CDK**, because it is not an AWS resource. **Decided: created and managed by hand, documented here.** One project, two long-lived branches, created once and essentially never changed — a Terraform/Pulumi provider in an otherwise all-CDK repo would be more moving parts than it saves. What exists outside CDK is exactly: the project above, its branches, and the SSM parameters holding its connection strings.
- **Corollary — there is no third deploy path.** Neon's own project tooling (`neon.ts` config, `neon deploy`) is deliberately **not** adopted. Schema changes go Drizzle → generated migration → CI, and nothing else touches the database structure. Adopting a vendor deploy command alongside CDK and Drizzle would recreate precisely the "which thing owns my schema?" ambiguity these rules exist to prevent.
- **The Function URL must not be reachable except through CloudFront**; otherwise you have two front doors and only one has your headers and caching rules. **Not with OAC** — that was the step-1 design and step 2 reversed it: OAC signs the origin request by writing its own `Authorization` header, overwriting the viewer's `Bearer` token, and Lambda refuses a signed request whose body is not hashed in `x-amz-content-sha256`, which no webhook sender or MCP client will add. Step 1 only had a `GET` with no auth, so neither showed. Instead the URL is `AuthType: NONE`, CloudFront sends a CDK-generated secret (Secrets Manager) as the `x-origin-verify` origin header, and the app refuses any request without it before doing anything else.
- **Distribution changes take several minutes to propagate.** Expect a slow iteration loop for one afternoon, then never think about it again.

---

## Step 2 — Auth and core schema

**Goal:** a request arrives with a Clerk token, gets verified, and resolves to a row in your `users` table.

**What you build:**

- Clerk's React SDK on the frontend. Token goes in the `Authorization` header on every API call.
- Middleware in the Hono app that verifies the token and attaches the resolved internal user to the request context. Verify JWTs offline against Clerk's public key rather than calling their API per request.
- The `users` table exactly as `data-model.md` §3.2 defines it: **UUIDv7 primary key minted in application code**, `clerk_user_id TEXT NOT NULL UNIQUE` as the single point of coupling to Clerk, and the three billing columns from §3.8 (`sub_status`, `sub_current_period_end`, `stripe_customer_id` — there is no `sub_tier`).
- The plan-side tables: `exercises`, `exercise_metrics`, `user_exercise_settings`, `workout_programs`, `workout_plans`, `workouts`, `planned_exercises`, `planned_sets`. The session tables can wait for step 3, but do not invent anything that is not in `data-model.md`.
- **The standard exercise catalog, seeded.** This is a real task and it is easy to leave off a plan: the app is unusable with an empty catalog, and every entry needs its `exercise_metrics` rows deciding which fields the logger renders. Use **fixed, hard-coded UUIDs** so a catalog entry has the same id in every environment and fixtures are portable. Budget an afternoon for the content, not five minutes.

**Watch out for:**

- **Ids are minted in app code, never by a database default.** UUIDv7 for time-ordering, so index locality stays close to a sequence. This is what makes step 3's offline writes possible — see `data-model.md` §2.11 — and it needs to be true from the first migration, because changing key types later is not a migration you want to write.
- **Key on the token's `sub`, never the email.** Emails change and are not guaranteed unique across identity providers.
- **Lazy-create the user row on first authenticated request** rather than wiring up Clerk's `user.created` webhook. Fewer moving parts, no ordering problems if the webhook is slow, and one less endpoint to secure. The one webhook worth wiring is `user.deleted`, and it soft-deletes (`data-model.md` §4).
- **Write entitlement checks from day one** against `users.sub_status`, with everyone hardcoded to an entitled value until step 5. The shape is two middlewares: `requireAuth` on everything, `requirePro` (`sub_status IN ('TRIALING','ACTIVE')`) on exactly the Pro route groups — progression analytics and, later, MCP tools. The Free/Pro boundary itself is `data-model.md` §3.8. Retrofitting entitlement across forty endpoints later is genuinely miserable, and this is the single cheapest thing in this document.
- **Migrations run from CI or from a script**, against a connection string. No tunnel, no bastion, no migration Lambda. Decide which one and make it the only way — ad-hoc migrations from a laptop are how environments drift. **Decided in step 2: CI**, on merge to `main`, migrating `dev` then `production` and seeding the catalog after each (`.github/workflows/ci.yml`).

---

## Step 3 — Vertical slice

**Goal:** start a workout, log a set with airplane mode on, and watch it appear in history once signal returns. Working end to end.

**What you build:**

- Service-layer functions that know nothing about HTTP. `startWorkout()`, `logSet()`, `getWorkoutHistory()`. The Lambda handlers call them. In step 6 the MCP tool handlers call the same ones. If you write this logic inside route handlers, step 6 becomes a rewrite instead of an adapter.
- Zod schemas defined once and imported by both the API and the frontend.
- The actual UI for logging a set, in whatever your real design language is going to be.

**The offline architecture, concretely.**

This is optimistic-writes-plus-a-durable-queue, not full local-first. The
distinction is deliberate and argued in `data-model.md` §2.11; the practical
version is that only four operations ever run without a connection — start a
session, log a set, edit or delete a set, finish a session — and all four write
to `workout_sessions`, `session_exercises`, and `session_sets` and nowhere else.
Everything on the plan side stays an ordinary server round trip with real
transactions.

What that means you build:

- **A service worker so the app shell loads offline at all.** `vite-plugin-pwa`. Easy to forget, and offline writes are meaningless without it.
- **A persisted mutation queue** in IndexedDB. Writes land locally and return immediately; the queue flushes in the background. Be realistic about the plumbing: TanStack Query's persisted mutation cache is the starting point, but resuming persisted mutations after a page reload requires hydration-time default mutation functions, and this app has two requirements the library does not guarantee out of the box — **strictly ordered, serial flush per session** (a delete-plus-renumber must not interleave with later set logs) and **transactional grouping** (the renumber is one request, not N). Expect to write a small explicit queue — an ordered array of pending operations in IndexedDB, flushed serially — and use TanStack for caching and reads. This is the hardest code in steps 0–4; budget accordingly rather than assuming a plugin covers it.
- **The client mints UUIDv7 ids** for the session, its exercises, and its sets, so a whole subtree exists before the server has seen any of it.
- **Every write endpoint is idempotent on that id** — `ON CONFLICT (id) DO NOTHING`. This is the entire idempotency story; there is no separate request-id column and no dedupe table.
- **Prefetch at session start**, while there is still signal: the `planned_exercises` and `planned_sets` for that workout, the relevant `user_exercise_settings`, and last cycle's numbers for the same exercises. A few dozen rows.
- **The client resolves `weight_unit`** from those cached settings and sends it explicitly, because it cannot run the server's `COALESCE` (`operations.md` §4.3). The server keeps that `COALESCE` as a fallback.
- **Preserve queue ordering per session exercise.** Deleting a logged set means renumbering the survivors, which has to reach the server as one transaction rather than N independent updates.

What you deliberately do **not** build: a sync engine, `updated_at` on every
table, tombstones, a change feed, or any conflict-resolution policy. One user,
one in-progress session, one device — conflicts are close to unconstructible.
If multi-device ever arrives, the client-minted ids are already in place and
adding `updated_at` is a migration rather than a rewrite.

**Watch out for:**

- **Every query filtered by user ID, enforced in one place.** Write a helper that takes the authenticated user and scopes the query, and make it the only way data is read. Doing this per-endpoint means eventually forgetting once, and forgetting once is a data breach. This helper is also where the cross-tenant invariants live that the schema deliberately does not enforce — that a session's `workout_id` belongs to the same user, that a `planned_exercise_id` does too (`data-model.md` §3.6). Cover it with a test that tries to read another user's rows.
- **One shared predicate for "a set that counts"** — `parent_set_id IS NULL AND kind <> 'WARMUP'`. It has to appear in every count, chart, PR check, and progression query, forever. Omitting it inflates set counts and corrupts charts silently. Write it once, in `packages/db`, and never inline it.
- **Do not pre-create empty set rows** when a session starts. A set that did not happen is no row; pre-creating turns "I only did 3 of 5" into a delete plus a renumber (`operations.md` §0.1).

---

## Step 4 — Broaden

**Goal:** the rest of the app, against a schema you have now used in anger.

**One named deliverable: program import/export** (`operations.md` §3.13, §5.4).
This is the first half of the AI story, and it deliberately ships before — and
independent of — the MCP server:

- **The format is the shared Zod schemas**, serialized: a JSON document
  describing program → cycles → workouts → exercises (by *name*) → sets.
  Publish it on a stable page with a worked example, written so a user can
  paste the spec plus their goals into any chatbot and get a valid document
  back. Pre-authored cycle variation works naturally — the format is just the
  plan tree, so a deload at cycle 9 is simply cycle 9 looking different.
- **Import is paste → validate → resolve exercise names → preview → create**,
  through the same service function as manual creation. Validation errors must
  be written to be pasted back into a chatbot verbatim.
- **Export is the same schemas in reverse** — one program's plan tree, plus a
  full-account export (every row the user owns). Both free; export is never
  paywalled.
- Why this exists when MCP is coming anyway: connecting a custom MCP server
  requires a paid AI plan on the major platforms, and the specifics keep
  shifting. Paste-import works with every model's free tier, forever, with no
  OAuth and no spec churn. MCP (step 6) is the premium live integration on top,
  not the only door.

Things to keep an eye on:

- **Pagination from the start**, on anything that returns a list. Workout history grows without bound and the query that is fine at 50 workouts is not fine at 5,000.
- **N+1 queries.** A workout has sets, a plan has exercises. Loading a history page naively means one query per workout. Drizzle will let you do this happily and it will be fast right up until it is not.
- **The clone primitive is the highest-risk code in the app.** Creating a program, copying an old one, applying an edit to remaining cycles, and extending a program are all the same walk (`operations.md` §0.2). Write it once, test it directly, and pay attention to the guard in §3.8 — a blunt re-clone silently destroys a cycle the user deliberately made different, which is the one thing materialized cycles exist to allow.
- **The purge job.** `data-model.md` §4 specifies a scheduled hard-delete of users soft-deleted more than six months ago. That is an EventBridge rule and a small Lambda, and it will not build itself.
- **Date-bucketed stats take their boundaries from the client** (user-local timezone), never from server `now()` truncation — `data-model.md` §5. Bake this into the analytics endpoints' request schemas from the first one.
- **Program name collisions auto-suffix** on copy and import (`operations.md` §3.9) — decide the helper once, use it in both paths.

---

## Step 5 — Payments

**Goal:** a user can subscribe, change plan, and cancel, without you building any subscription UI.

**What you build:**

- Stripe Checkout for the purchase. Stripe hosts the page.
- Stripe Customer Portal for plan changes, cancellations, and card updates. Stripe hosts that too.
- A webhook handler that writes subscription state into the billing columns on `users` that have been there since step 2.
- Flip the entitlement middleware from hardcoded-entitled to reading `sub_status`. The Free/Pro boundary is `data-model.md` §3.8: logging, program building, and import/export stay free; `requirePro` gates progression analytics and (step 6) MCP tools. No request path ever calls the Stripe API to answer "is this user subscribed?".

**Watch out for:**

- **Webhook signature verification needs the raw request body.** The Function URL event hands you a possibly base64-encoded body, and Hono's default JSON parsing will consume the stream. Getting the exact bytes Stripe signed is the single most common Stripe-on-Lambda failure. Solve it deliberately rather than discovering it in production. Route it through CloudFront like everything else, as Clerk's `/api/webhooks/clerk` already is: the origin-secret check (step 1) accepts any POST that came through CloudFront, and the webhook's own signature is what authenticates the sender. Add its path to the API's public-path list.
- **The webhook endpoint must not require a Clerk token.** Stripe is not a logged-in user. Exclude that route from your auth middleware explicitly, and rely on signature verification as its authentication.
- **Make the handler idempotent** via the `processed_stripe_events` table (`data-model.md` §3.8): insert the event id and apply the state change in one transaction, so a redelivery hits the primary key and is discarded.
- **Webhook delivery is not ordered.** A `customer.subscription.updated` can arrive after the `deleted` that supersedes it. Compare the event's timestamp against what you have stored, or re-read the subscription from Stripe when applying.
- **Checkout can complete before your handler runs**, so the user may land back in the app un-entitled for a second. Refetch on the success page rather than trusting the redirect.
- **Treat Stripe as the source of truth, cache status locally.** The local columns are a cache, and the webhook is what refreshes it.
- **US state sales tax on digital subscriptions varies by state.** Stripe Tax handles it as a paid add-on. Worth knowing before you have customers rather than after.
- **"US only" is a billing posture, not code** (`data-model.md` §7 #28): USD pricing, Stripe direct, no merchant of record, and no geo-gating logic anywhere. Do not build region checks.
- **No NAT problem.** This bullet used to say "this is where the no-NAT decision comes due." It does not, because the Lambda is not in a VPC — outbound calls to Stripe just work. That is one of the concrete payoffs of step 1.

---

## Step 6 — MCP server

**Goal:** a user connects their ChatGPT or Claude account and can build workout plans conversationally.

**What you build:**

- MCP tool handlers that call the same service-layer functions from step 3. Thin adapter, no duplicated logic.
- **Read tools are the point, not an afterthought.** "Write me a program" is something any chatbot does without your data; the loop only this connector enables is "look at my last eight weeks and adjust the next block." Expose the existing aggregate queries as tools — recent sessions per exercise, cycle-over-cycle progression (`operations.md` §5.2), plan-vs-actual adherence (§5.3) — rather than making the model reconstruct aggregates from raw sets. Alongside them, the plan-construction write tools (create/edit program, which can reuse the §3.13 import schema as their input shape).
- Protected Resource Metadata at `/.well-known/oauth-protected-resource`, which the spec has required since the 2025-06-18 revision.
- Clerk as the authorization server, with CIMD enabled.

**Watch out for:**

- **Build on CIMD, not DCR.** The 2026-07-28 spec deprecated Dynamic Client Registration in favor of Client ID Metadata Documents. DCR still works for backward compatibility with a minimum twelve-month runway, so support both, but default to CIMD. Clerk's CIMD support was in beta as of this writing and requires contacting their support to enable.
- **Never pass a client's bearer token through to an upstream API.** Your server is an OAuth client to those services and obtains its own tokens. Forwarding is the confused-deputy problem and the spec forbids it.
- **Scope the tools narrowly.** An LLM with a `deleteWorkoutHistory` tool will eventually call it. Expose reads and plan-construction writes; keep destructive operations out of the tool surface entirely. Note that the schema is already on your side here — programs with logged sessions cannot be deleted, only archived.
- **Entitlement applies here too.** MCP tool calls are authenticated requests, and the MCP surface is Pro by decision (`data-model.md` §3.8) — every tool goes through `requirePro`, or you have given away the paid feature by accident.
- **Reach is limited by the AI platforms, not by you.** Connecting a custom MCP server currently requires a paid plan on the major chat products, and the gating details shift. This is why the import/export format shipped in step 4: free-tier users of any AI already have a working path, and MCP is the premium live integration, not the only one. Check current connector requirements when you get here.
- **The spec is moving fast.** It changed substantially in both November 2025 and July 2026. Check the current revision when you actually get here rather than trusting a plan written months earlier.

---

## Applies throughout

- **Everything in CDK** except Neon, which is not an AWS resource — see step 1 for how that gets tracked. If you clicked it in the console, it does not exist. You will want to tear down and rebuild at least once.
- **Service layer stays HTTP-agnostic** from step 3 onward. This is the single decision that makes step 6 cheap.
- **Tests, from step 3.** There is no test strategy anywhere else in this document, and with agents writing the code it is the load-bearing safety net. The minimum worth having: integration tests against a real Neon branch for the clone primitive, the "what's next?" query, the offline replay path (same insert twice, one row), and the scoped-query helper refusing another user's data.
- **Observability.** Structured logs from the Lambda, an error tracker on the frontend, and a CloudWatch alarm on Lambda errors and 5xx rates. Cheap, and the alternative is learning about breakage from a user who is paying you.
- **Backups.** Neon handles PITR, but restoring is a thing you should have done once on purpose before you need to do it in a hurry.
- **Your own training history — decided: not migrated.** No import script, no backfill; the new app starts empty. Note the consequence, accepted knowingly: the only legacy export on disk is a five-rows-per-table sample, so that history becomes unrecoverable once the legacy RDS instance is gone. Tearing that instance down is still open, and it is still costing money and still holding a live plaintext credential for a real person's account (`legacy-overview.md` §0, untracked).
- **Check the billing console monthly.** The target is roughly $5 to $25/month: Neon free to about $19 depending on whether you pay to disable autosuspend, Lambda effectively free at your volume (and no API Gateway at all), CloudFront and S3 a couple of dollars, Parameter Store free, Clerk free below its MAU threshold, Stripe a percentage of revenue rather than a fixed cost.
- **Verify pricing and free-tier terms yourself before committing.** AWS changed its free tier model in July 2025 and Clerk changed its pricing in February 2026. Both will change again, and so will Neon's.
