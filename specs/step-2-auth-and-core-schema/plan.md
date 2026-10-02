# Step 2 — ordering

Why this exists: the ordering is not obvious, and several orderings that *look*
obvious are wrong. There is no `tasks.md` — it would restate
`docs/workout-tracker-build-plan.md` step 2 and the phases below.

**1. The domain, the certificate, and the Clerk production instance — first.**
`tanrenstrength.com`, registered 2026-10-01 through Route 53 in the
`workout-tracker` account, which created the public hosted zone as a side
effect — the stacks **look that zone up** rather than creating one (decision 5).
Confirm the ICANN contact email was verified; an unverified domain is suspended
after about 15 days, and that failure presents as a DNS problem. Then add the `us-east-1` certificate stack and
`crossRegionReferences`, the CloudFront alias, and the site's DNS records. Create the Clerk production instance and put its
Frontend API, accounts-portal and email records into the same hosted zone, in
CDK.

This goes first because most of it is **wall-clock wait, not work** — ACM
validation and Clerk's DNS propagation both settle on their own schedule. Start
them, then walk away and do phase 2 while they finish. Put them anywhere later
and they become the thing everything else queues behind.

**2. Spike Drizzle's expressiveness, against a throwaway Neon branch.**
Before writing the real schema, establish which of these round-trip through
`drizzle-kit generate` and which need a `--custom` migration: the two
`DEFERRABLE INITIALLY DEFERRED` position uniques, the three partial unique
indexes, `target_weight_kg` as a stored generated column, the `num_nonnulls`
check, and the seven enums. Throwaway branch per the `neon-branch` skill — never
`dev`, never `production`. Output is a list, and it is allowed to change
decision 7 in `overview.md`.

**3. Schema and migration, committed together.** `users` first, then the eight
plan-side tables. Read the generated SQL before committing it. Applied only to
the throwaway branch at this point — nothing has touched `dev` yet.

**4. CI, and the first real migration run.** ESLint and Prettier config, the CDK
OIDC provider and the two roles, then the two workflows. `dev` and `production` get their
first migration **through CI**, which is the only way they are ever allowed to
get one. Doing this before the auth work is the point: if CI comes last, the
first migration inevitably gets applied from a laptop "just to unblock", and the
rule is dead on the day it is written.

**5. The auth path, back to front.** SSM parameters and the Lambda grant in CDK;
`verifyToken` middleware; the select-first identity resolution; `requireAuth` and
`requirePro`; the `user.deleted` webhook route. Verified through CloudFront on
the real domain with a real token, not just locally — step 1's lesson was that
the edge is where this kind of thing breaks.

Auth cannot come before the schema, however much it looks like the independent
half: the middleware's first act is a read of `users`.

**6. The frontend.** `ClerkProvider`, prebuilt components, token on every call.
Small, and it is the first point where the whole pipe is demonstrable.

**7. The catalog.** Deliberately last. It is the longest task and the least
risky, and doing it first would burn an afternoon before learning anything about
whether the hard parts work. Budget an afternoon for the content itself —
roughly 60–80 standard exercises covering the major movement patterns, each with
its `exercise_metrics` rows, which are what decide the fields the logger renders
in step 3. Fixed UUIDs, generated once and then never regenerated.

**8. Close the loop, in the commit that lands the schema — not after.** Delete
the DDL from `docs/data-model.md` §3 and delete `docs/schema.dbml` entirely.
Correct the JIT-upsert SQL block in §3.2 to the select-first form (decision 3);
its surrounding prose is right and stays. Correct
`docs/workout-tracker-build-plan.md` step 1, which records the custom domain as
deferred — decision 5 un-defers it — and add a superseded note to the "no custom
domain" bullet in `specs/shipped/step-1-infrastructure-skeleton/overview.md`.
Update `.claude/skills/schema-change/SKILL.md`, which currently says the
placeholder is still a placeholder and that no CI exists; both stop being true
here. Add the nested `CLAUDE.md` files for `apps/api` and `packages/db`. Archive
this spec.
