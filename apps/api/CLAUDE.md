# apps/api

Hono on one Lambda, behind CloudFront at `/api/*`. Routes are adapters: logic
lives in the service layer, queries in `packages/db` (root `CLAUDE.md`).

## Layout

- `src/app.ts` — `createApp(deps)`: every route and the auth wiring. Takes its
  dependencies as an argument so tests run the real app with fakes.
- `src/deps.ts` — the production dependencies (Clerk, Neon, SSM, Secrets
  Manager). The only file that reads the `CLERK_*` and `ORIGIN_*` env vars.
- `src/lambda.ts` — `handle(createApp(productionDeps()))`, nothing else.
- `src/origin.ts` — `requireCloudFront`: refuses any request without the
  `x-origin-verify` secret. Runs first, before the public routes too. The
  Function URL is public; this is what keeps CloudFront the only way in.
- `src/auth.ts` — `requireAuth`, `requirePro`, `BILLING_NOT_LIVE`.
- `src/secrets.ts` — memoised SSM SecureString and Secrets Manager reads. A new
  SSM parameter also goes in the Lambda's grant in
  `infra/lib/workout-tracker-stack.ts`; the infra test pins the exact list.

## Auth

- **Everything is behind `requireAuth` unless it is in `PUBLIC_PATHS`** in
  `app.ts` — exact paths, no prefixes. A new route is authenticated by default;
  making one public is a deliberate edit to that list. Signed-out requests to
  unknown paths get 401, not 404.
- `c.get("user")` is `{ id, subStatus }` — `id` is `users.id`, the thing every
  query is scoped by. Never pass the Clerk id further than identity resolution.
- `requirePro` goes on exactly two route groups: `/analytics/*` (mounted) and
  the MCP tools (step 6). Moving a feature across the Free/Pro line is moving
  that middleware, nothing else.
- `BILLING_NOT_LIVE` is deleted in step 5. Do not set `sub_status` to fake
  entitlement instead (spec step 2, decision 4).
- Token verification is `verifyToken` with `authorizedParties` from the
  `CLERK_AUTHORIZED_PARTIES` env var, which CDK derives from the domain. Never
  hardcode origins here.

## Webhooks

`POST /api/webhooks/clerk` is public by bearer token and authenticated by
signature (`verifyWebhook`). Handlers must be idempotent — Clerk redelivers —
and acknowledge event types they do not handle with a 2xx.

## Tests

`npm test -w @workout-tracker/api` — no database, no network. Send requests
through the test file's `viaCloudFront` helper, which adds the origin secret;
`createApp(...).request` directly is refused with 403. Webhook tests
sign requests with HMAC like Clerk does, so they exercise the real
`verifyWebhook`. Anything that needs real rows belongs in `packages/db`'s
integration tests.
