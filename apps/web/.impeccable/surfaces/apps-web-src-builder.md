---
version: 1
slug: "apps-web-src-builder"
primary_target: "apps/web/src/screens/builder"
related_targets: ["apps/web/src/screens/program-detail.tsx", "apps/web/src/screens/exercises.tsx", "apps/web/src/screens/workout/workout.tsx"]
---

# Surface brief: program builder, program detail, exercise picker and catalog

Mode: **Operate**, for a calmer planning job done outside the workout. Shaped with the user 2026-10-29/30 (OpenSpec `step-4a-program-builder`, task 1.3). The user chose layout A, "one outline page", over a drill-down or a spreadsheet grid. Programs are built **equally on phone and laptop**, so both must feel right.

## Builder (create a program, or edit one cycle)

- **Top:** a back link to the program, then its name and length. When creating, there is a name field and a length choice, "N cycles" or "open-ended".
- **Cycle strip** `1 2 3 … N`, scrollable. It marks logged cycles (●) and cycles that differ from cycle 1 (◆). When creating, only cycle 1 is shown.
- **Workouts are numbered sections:**
  - The name is editable in place.
  - An optional notes line holds rest guidance (`data-model.md` §3.7).
  - A ⋯ menu offers Rename, Move up/down and Remove.
  - At the end, **+ Add workout**.
- **Each slot is one row**, with a summary such as "5 × 5 @ 225 lb", "3 × 8–10" or "3 × 5 @ RIR 2". Tapping it opens it in place:
  - A target-sets stepper.
  - One line that applies to every set: reps (exact, or a min–max range), weight with the user's unit, and an optional effort target.
  - A **"prescribe each set"** toggle that switches to one line per set, for ramps, back-off sets and rep ranges.
  - **Effort target, added at the user's request:** each set may carry **RIR or RPE**, never both, chosen per set by a small RIR/RPE switch. It is a prescription only: during logging the lifter still records weight and reps, and the workout screen shows the target beside the prescription ("5 × 225 · RIR 2").
- **Row ⋯ menu:** Superset with next, Ungroup, Replace exercise, Move up/down, Remove, Notes. On a laptop, rows can also be dragged to reorder.
- **Supersets** show a copper bar along the group and derived labels A1/A2, B1/B2 (not stored).
- **Placeholder slots** show as ∘ "label" with their set count. They are created from the picker's "Add a placeholder instead" (free text).
- **When editing a later cycle,** trained workouts are greyed with "Logged <day> · locked". They can't be edited, moved, or have anything placed before them (design D5).
- **Sticky save bar:** "Save cycle n", or **Create program** when creating. A new program is a DRAFT.
- **Apply check:** when later cycles exist, saving opens it, worded as in `operations.md` §3.8:
  - Every later cycle is listed as a checkbox.
  - Matching cycles are pre-checked.
  - A cycle that differs is unchecked and annotated "looks intentionally different".
  - Logged cycles are listed as unchangeable.
  - Buttons: **Save to cycle n only** and **Save and apply to k cycles**.
  - A stale refusal says to reload and try again.
- **Draft:** unsaved work persists on the device. On return, a banner reads "Unsaved changes restored · Discard".
- **No shorthand text entry** such as `5x5@225`. The user judged it confusing.

## Exercise picker

A side panel on a laptop and a full-screen sheet on a phone, containing:

- search;
- muscle and equipment filters;
- recently used exercises;
- the list, with standard and the user's own exercises;
- **Create custom exercise**: name, metrics (each required or optional), muscles, equipment;
- **Add a placeholder instead**.

## Exercise catalog screen

Reached from the Programs screen and from the picker:

- the same list and filters;
- the user's own exercises can be edited (not their metrics), retired and reactivated, with a "Show retired" toggle;
- setup and cues on any exercise.

## Program detail

- **Header:** name, status, length; actions Activate or Archive, Rename, Copy, and Run another cycle for a finished fixed program.
- **Cycle list:** each row reads "Cycle n · k workouts" with a marker (logged ✓ / current / "same as cycle 1" / ◆ different) and an **Edit ›** link into the builder for that cycle.

## Logger stopgap (workout screen)

Placeholder slots, and exercises that aren't plain weight and reps, show as rows with their label or name and target sets, and the note "Logging this arrives soon", with **Skip**. They take no set entry.

## Constraints

- Design system as built (`apps/web/DESIGN.md`).
- WCAG 2.2 AA, full keyboard operation including reordering.
- Online-only except the draft (operations.md §0.3). Offline, the builder says saving needs a connection and keeps the draft.

## Decided without the user (review in the morning)

- RIR and RPE are mutually exclusive per set and stored as written (design D16), not converted between each other.
- RIR range 0–10 in steps of 0.5; RPE 1–10 in steps of 0.5.
