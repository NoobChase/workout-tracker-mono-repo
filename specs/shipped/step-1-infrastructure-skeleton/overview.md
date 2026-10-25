# Step 1 — Infrastructure skeleton

> **Status: SHIPPED (2026-09-18). This is a record, not a spec.**
>
> Per the working conventions in `docs/workout-tracker-build-plan.md`, specs
> govern *before* implementation and code governs *after*. Step 1 is deployed,
> so nothing here is an instruction — where this file and the code disagree,
> **the code is right and this file is stale**. It is kept only for the
> decisions and the one non-obvious failure recorded below, none of which are
> derivable from reading the CDK. Kept as an archived record after step 2
> landed (decided 2026-10-25); no deletion is planned.
>
> **Step 2 has landed and changed two things below:** the custom domain now
> exists, and the Function URL is no longer behind OAC — it is `AuthType: NONE`
> with a CloudFront secret header (step 2 spec, decision 14), so the OAC
> failure recorded here is history, not a live trap.

**Goal (met):** hello-world flowing browser → CloudFront → Lambda Function URL →
Neon → back, defined entirely in CDK.

## What exists now

Monorepo scaffolded per the repository-layout section — npm workspaces, no
Turborepo:

```
apps/web/      Vite + React 19 + TS + Tailwind v4. One page, fetches /api/hello.
apps/api/      Hono on Lambda. One route. Neon WebSocket Pool + SSM at cold start.
packages/shared/  Zod. Currently just the hello-world response contract.
packages/db/      Empty placeholder — see "deliberately not done" below.
infra/         CDK. One stack, WorkoutTrackerProduction, us-east-2.
```

`apps/mcp` is not created; it arrives in step 6.

The stack (`infra/lib/workout-tracker-stack.ts`) stands up: a private S3 bucket,
a CloudFront distribution reaching it through OAC, an `/api/*` behaviour
pointed at a Lambda Function URL also locked down with OAC, the Hono Lambda
itself with **no VPC configuration at all**, and a `BucketDeployment` that
uploads `apps/web/dist` and invalidates the distribution.

Deployment is `npm run deploy` from the root, which builds the web app first
because the bucket deployment asset-bundles its `dist`.

## Decisions made during the build that are not in `docs/`

These are the ones a future reader would otherwise have to reverse-engineer.

**SPA routing is a CloudFront Function, not `errorResponses`.** The obvious way
to make client-side routes reload correctly is a distribution-wide custom error
response mapping 403/404 to `/index.html`. It is wrong here, and quietly so:
CloudFront applies custom error responses to **every** behaviour including
`/api/*`, so a genuine API 403 or 404 comes back to the browser as a `200`
carrying the HTML shell. That is survivable for a hello-world and actively
dangerous in step 2, where `requireAuth` failures are exactly 401/403. A
viewer-request function on the default behaviour only, rewriting extensionless
paths, has the same effect with none of the blast radius. There is a test
asserting `CustomErrorResponses` is absent.

**No CORS response-headers policy on `/api/*`.** The PWA and the API share an
origin, so there is no preflight to satisfy. The managed
`CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT` policy was in the first draft and was
removed: allow-all is the wrong default to carry into authenticated routes.

**`@aws-sdk/client-ssm` is bundled, not taken from the runtime.** The Node 22
Lambda runtime does ship the v3 SDK, so leaving it external would work today.
It is bundled anyway — the runtime's copy is a version AWS controls and has
signalled it may stop shipping, and this is the one dependency whose absence
breaks the function before it can log anything.

**Explicit `logs.LogGroup` rather than `logRetention`.** The `logRetention` prop
is deprecated and works by provisioning a custom-resource Lambda to mutate the
log group after the fact. An explicit log group is one resource instead of
three, with a real `RemovalPolicy`.

**`webDistPath` is a test seam.** The stack prop defaults to the real
`apps/web/dist`. It exists so `infra/lib/workout-tracker-stack.test.ts` can
synthesise against a stub directory instead of depending on a prior web build.

**The SSM read is a memoised module-scope `Promise`, not a resolved value.**
Caching the promise rather than the pool means concurrent first requests share
one in-flight `GetParameter` instead of racing to issue two. The Lambda also
asserts at startup that the string it got contains `-pooler.`, so a
misconfigured parameter fails loudly at cold start rather than subtly at
step 4's first interactive transaction.

## The failure worth remembering

The first deploy returned `index.html` for `/api/hello`. Two problems stacked:

1. The `errorResponses` described above were rewriting the real failure into a
   `200`. Removing them exposed a `403 AccessDeniedException`.
2. The actual fault: **CDK's `FunctionUrlOrigin.withOriginAccessControl` grants
   only `lambda:InvokeFunctionUrl`.** AWS documents *two* grants for this setup
   — `lambda:InvokeFunctionUrl` **and** `lambda:InvokeFunction` — and without
   the second, CloudFront's SigV4 signature verifies, the request is then
   refused, and **the function is never invoked, so CloudWatch holds nothing at
   all.** The absence of a log line is the tell: it means the rejection happened
   in the Function URL authorizer, upstream of the runtime.

   Source: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html>

The stack now adds the `InvokeFunction` grant explicitly alongside the one CDK
emits. `infra/lib/workout-tracker-stack.test.ts` asserts both are present; that
assertion was mutation-checked (inverted, confirmed failing, restored) rather
than trusted. **If a CDK upgrade ever makes that test look redundant, check
whether CDK started emitting both grants before deleting it.**

## Verified against the deployed stack

| Check | Result |
|---|---|
| `/api/hello` through CloudFront | `200`, real `select now()` against Neon (PostgreSQL 18.6) |
| Second call | `coldStart: false` — the pool survives invocations |
| Bare `*.lambda-url` host, direct | `403` |
| S3 REST endpoint, direct | `403` |
| `/`, `/history/123`, `/assets/*.js` | `200` — SPA deep links reload |
| `/api/nope` | `404` JSON, **not** rewritten to `index.html` |
| `npm run typecheck` (5 workspaces) | clean |
| `npm test` (8 infra assertions) | pass |
| `cdk diff` | no drift between code and deployed stack |

## Deliberately not done

- **No custom domain and no ACM certificate.** *Superseded in step 2*, which
  landed `tanrenstrength.com`, the `us-east-1` certificate stack and
  `crossRegionReferences` (`specs/shipped/step-2-auth-and-core-schema/`,
  decision 5). Originally: decided mid-build and reflected
  in `docs/workout-tracker-build-plan.md` step 1: the distribution's default
  `*.cloudfront.net` name already serves HTTPS. There is therefore **no
  `us-east-1` stack and no `crossRegionReferences`** yet. When the domain lands
  — before launch, since Clerk's production instance needs one — the
  certificate must be requested in `us-east-1`; `infra/bin/infra.ts` carries a
  comment saying why.
- **`packages/db` is an empty placeholder.** The DDL in `docs/data-model.md`
  and `docs/schema.dbml` is therefore **still authoritative**. The root
  `CLAUDE.md` rule about deleting it keys off the Drizzle schema file existing,
  and it does not yet. That deletion is step 2's job.
- **No linter.** `npm run lint` is a no-op across all workspaces, so the
  "lint passes" clause of the definition of done is currently vacuous. Choosing
  and configuring one is an open decision, not an oversight.
- **`cdk bootstrap` used the default `AdministratorAccess` execution policy.**
  Acceptable for a skeleton; worth narrowing before real users.
- **No CI.** Migrations-run-from-CI-only is a step 2 concern; there is nothing
  to migrate yet. Deploys so far are from a laptop against the
  `workout-tracker` SSO profile.

## Open items inherited from step 0

Still unconfirmed, per the step 0 status note: **root MFA, the $30 budget
alert, and the root-only billing-access toggle.** None of them block step 2.
