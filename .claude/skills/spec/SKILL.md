---
name: spec
description: Decide whether a change needs a spec, write one in specs/<feature>/, or archive a spec once its feature ships. Use at the start of a multi-layer or schema-touching feature, when starting a numbered build step, and immediately after one lands.
---

# Specs

Spec-driven, kept deliberately light. **Specs govern before implementation; code
governs after.**

## Does this need one?

Yes, if it touches **the schema, the auth model, or more than one layer**.
Build steps 2–6 in `docs/workout-tracker-build-plan.md` all qualify.

No, otherwise. A bug fix, a copy change, one endpoint against an existing table
— skip the ceremony and just do it. A spec for a small change is a document
nobody reads and everybody has to keep current.

## Writing one

`specs/<feature>/overview.md`, plus `plan.md` and `tasks.md` if the feature is
big enough that the ordering is not obvious. Keep them short — this is a record
of decisions, not a design doc; the design already lives in `docs/`.

What earns its place:

- **Goal**, in one sentence, stated so you can tell whether it is met.
- **What this changes**, by workspace.
- **Decisions made here that are not derivable from `docs/`** — the reason the
  file exists at all.
- **Deliberately not done**, with the reason. Prevents the next reader
  "finishing" something that was a decision.
- **Verification** — what was actually run, with results.

What does not: restating `docs/data-model.md`, restating `CLAUDE.md`, or a task
list that duplicates the build plan. Do **not** define "done" here; it is
defined once, in `CLAUDE.md`.

`specs/shipped/step-1-infrastructure-skeleton/overview.md` is the reference
shape — read it before writing a new one.

## Archiving — do this the moment the feature ships

A stale spec fed to an agent six months from now produces confident "fixes" to
working code. That is the failure this rule exists to prevent, and it costs
nothing to avoid.

1. Move it to `specs/shipped/<name>/`.
2. Put a status banner at the top: shipped, the date, and **"this is a record,
   not a spec — where this and the code disagree, the code is right."**
3. Cut everything now derivable from the code. Keep only the decisions and the
   non-obvious failures.
4. Note when it should be deleted outright.

Better still, delete it. Keep a shipped spec only for what a reader genuinely
cannot reconstruct by reading the code.

## Keeping `docs/` honest

When implementation contradicts a design doc, fix the doc in the same change —
after a feature ships the code wins, and a doc that lost an argument to reality
is worse than no doc. `docs/data-model.md` §7 is the exception: those decisions
are settled and are not reopened by a spec.
