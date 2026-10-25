# Project skills

Procedures that are too long for the root `CLAUDE.md` (which is capped at 100
lines) but that an agent needs the *whole* of when it is doing that one thing.

The division of labour:

| Where | What goes there |
|---|---|
| `CLAUDE.md` | Rules that must be in context for **every** task. Short, absolute, no procedure. |
| `docs/` | The design. Why the system is shaped the way it is. Governs before code exists. |
| `.claude/skills/` | Step-by-step procedure for one recurring task, loaded only when that task comes up. |
| `openspec/changes/<name>/` | One change, in flight (OpenSpec). Archived into `openspec/specs/` when it lands; see the `spec` skill. `specs/shipped/` holds steps 1–2, from before OpenSpec. |

A skill is worth writing when the same mistake is available twice: the
procedure has a non-obvious ordering, a footgun, or a verification step that is
easy to skip. If it is a one-line rule, it belongs in `CLAUDE.md` instead.

Each skill is `<name>/SKILL.md` with `name` and `description` frontmatter. The
description is the only part loaded until the skill fires, so it must say *when
to use it* in the user's vocabulary, not just what it is.

**Skills rot like docs do.** When a skill and the code disagree after a feature
ships, the code is right — fix the skill in the same commit that invalidated it.
