---
name: spec
description: Decide whether a change needs a spec, and if so run it through OpenSpec (/opsx:propose → /opsx:apply → /opsx:archive) under this project's rules. Use at the start of a multi-layer or schema-touching feature, when starting a numbered build step, and immediately after one lands.
---

# Specs (OpenSpec)

Spec-driven, kept deliberately light. **Specs govern before implementation; code
governs after.** The tool is OpenSpec (adopted 2026-10-25, replacing the old
`specs/<feature>/` convention); this skill is the project's rules for using it.
`openspec/config.yaml` carries the same rules so OpenSpec applies them while
writing artifacts.

## Does this need one?

Yes, if it touches **the schema, the auth model, or more than one layer**. Build
steps 3–6 in `docs/workout-tracker-build-plan.md` all qualify.

No, otherwise. A bug fix, a copy change, one endpoint against an existing table
— skip the ceremony and just do it. A spec for a small change is a document
nobody reads and everybody has to keep current.

## The loop

1. **`/opsx:explore`** (optional) to think a change through before committing
   to it.
2. **`/opsx:propose "<change>"`** creates `openspec/changes/<name>/`:
   `proposal.md` (why, what, out of scope), delta `specs/<capability>/spec.md`
   (requirements and scenarios), `design.md` (how), `tasks.md`. It plans only —
   no code in the same turn.
3. **`/opsx:apply`** works through `tasks.md`. `/opsx:update` revises the plan
   when a decision changes mid-flight — fold it in, don't let the plan drift.
4. **`/opsx:archive`** when the change ships: its delta specs merge into the
   living specs in `openspec/specs/`, and the change moves to
   `openspec/changes/archive/`.

The CLI (`openspec`, pinned at 1.14.1 globally and in the root `package.json`)
also answers `openspec list`, `openspec status --change <name>`, and
`openspec validate <name>`.

## What earns its place in the artifacts

- **Decisions not derivable from `docs/`** — the reason a change has a design
  at all. Link `docs/data-model.md`, `docs/operations.md` and the build plan by
  section; never restate them.
- **Out of scope / deliberately not done**, with the reason, in `proposal.md`.
  It stops the next reader "finishing" something that was a decision.
- **Verification** in `tasks.md`: what will be run, including the integration
  tests root `CLAUDE.md` requires against a real Neon branch.

Not: restating `CLAUDE.md`, re-deciding `docs/data-model.md` §7 (settled; a
change there is an explicit decision recorded in §7 itself), or defining
"done" (it is defined once, in `CLAUDE.md`).

## Archiving is the moment the change ships

A stale spec fed to an agent six months from now produces confident "fixes" to
working code. Archive in the same PR that lands the change, and before
archiving, correct the artifacts to what was actually built — the living specs
in `openspec/specs/` must describe the code, not the plan.

## Before OpenSpec

Steps 1 and 2 were specced in the old format and are archived in
`specs/shipped/` as records. Code comments cite "spec step 2, decision N";
those numbers live in `specs/shipped/step-2-auth-and-core-schema/overview.md`.
Do not migrate them into OpenSpec.

## Keeping `docs/` honest

When implementation contradicts a design doc, fix the doc in the same change —
after a feature ships the code wins. `docs/data-model.md` §7 is the exception:
those decisions are settled and are not reopened by a spec.
