---
name: deploy
description: Deploy the CDK stack to AWS, or change infrastructure (CloudFront, S3, Lambda, IAM, log groups). Use for "deploy", "ship it", "cdk diff", "add a behaviour/permission/bucket", or when a change works locally but must be verified through CloudFront.
---

# Deploying

Everything is CDK except Neon. **Nothing is created in the AWS console** — a
console-made resource is invisible to `cdk diff` and will be silently reverted
or, worse, silently kept forever.

## Before you deploy

```bash
aws sso login --profile workout-tracker     # 8-hour sessions
export AWS_PROFILE=workout-tracker
npm run typecheck && npm test               # all workspaces
npm run diff -w @workout-tracker/infra      # read it
```

Read the diff properly. `deploy` is configured `--require-approval any-change`,
so you will be asked about IAM and security-group changes; that prompt is the
last checkpoint, not a formality.

```bash
npm run deploy                              # from the repo root
```

Root `deploy` builds `apps/web` first, because the `BucketDeployment` asset-bundles
`apps/web/dist`. Running `cdk deploy` from `infra/` alone ships a stale frontend.

**Two stacks**, so every cdk command here is `--all`:

| Stack | Region | Holds |
|---|---|---|
| `WorkoutTrackerCertificates` | `us-east-1` | the ACM cert for `tanrenstrength.com` + `*.tanrenstrength.com`, nothing else |
| `WorkoutTrackerProduction` | `us-east-2` | everything else |

Both regions need `cdk bootstrap`. Account comes from the profile at deploy
time and is deliberately not written down in the repo; the domain and its
hosted zone id are, in `infra/bin/infra.ts`.

Ordering is automatic (`addStackDependency`), but note the consequence: until
the certificate stack has been deployed once, `cdk diff` on
`WorkoutTrackerProduction` cannot build a change set — the `/cdk/exports/...`
SSM parameter it reads does not exist yet — and falls back to a template-only
diff. That is expected, not a failure.

## Verify through CloudFront, never the origin

"Deployed" is not "works". The step 1 record (`specs/shipped/`) exists because
the first deploy returned `index.html` for `/api/hello` and looked fine.

| Check | Expect |
|---|---|
| `/api/hello` via the distribution | `200`, real query against Neon |
| same, called twice | `coldStart: false` |
| `/api/nope` | `404` **JSON** — not the HTML shell |
| bare `*.lambda-url` host, direct | `403` |
| S3 REST endpoint, direct | `403` |
| `/`, a deep link, `/assets/*.js` | `200` |
| `https://www.<domain>/x?a=1` | `301` to `https://<domain>/x?a=1` |
| `https://<domain>` certificate | valid, covers apex and wildcard |
| `cdk diff` after deploying | no drift |

Distribution changes take several minutes to propagate. Budget for it rather
than concluding the change did not work.

## Traps this stack has already hit

- **No distribution-wide `errorResponses`.** SPA fallback is a viewer-request
  CloudFront Function on the default behaviour only. Custom error responses
  apply to *every* behaviour, so a genuine API 401/403/404 comes back as a `200`
  carrying the HTML shell — fatal once `requireAuth` exists. A test asserts
  `CustomErrorResponses` is absent; do not "fix" it.
- **Function URL OAC needs two grants.** CDK's
  `FunctionUrlOrigin.withOriginAccessControl` emits only
  `lambda:InvokeFunctionUrl`. AWS requires `lambda:InvokeFunction` as well, and
  without it CloudFront's signature verifies, the request is refused upstream of
  the runtime, and **CloudWatch holds nothing at all** — an empty log is the
  tell. The stack adds the second grant explicitly and tests both.
- **No VPC configuration on the Lambda, ever.** That absence is the entire
  reason the bill is small and Stripe/Clerk/Neon all reach. Adding a VPC to
  "secure" it costs ~$33/mo in NAT and breaks step 5.
- **No CORS response-headers policy on `/api/*`.** Same origin, no preflight.
  Allow-all is the wrong default to carry into authenticated routes.
- **ACM certificates for CloudFront must be in `us-east-1`.** This is why
  `WorkoutTrackerCertificates` exists, pinned there, with
  `crossRegionReferences: true` on both stacks. A certificate issued in Ohio is
  simply invisible to CloudFront.
- **The hosted zone is referenced by id, never declared.** Route 53 created it
  with the domain registration. A `new HostedZone` for the same name publishes a
  second NS record set that the registrar does not delegate to, and the symptom
  reads as slow propagation rather than as a mistake. A test asserts the stack
  declares zero hosted zones.
- **One viewer-request CloudFront Function runs on *every* behaviour**, `/api/*`
  included, because it also redirects `www` to the apex and one origin has to
  hold for API paths too. It therefore guards `/api/` out of the SPA rewrite.
  That guard is the most load-bearing line in `infra/lib/edge/viewer-request.js`:
  without it every API call is rewritten to `index.html`. Its tests load that
  exact file and were mutation-checked.

## After an infra change

Add or update an assertion in `infra/lib/workout-tracker-stack.test.ts`.
Mutation-check it: invert the assertion, confirm it fails, restore it. An
assertion that has never failed proves nothing.
