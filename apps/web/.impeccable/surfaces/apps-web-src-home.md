---
version: 1
slug: "apps-web-src-home"
primary_target: "apps/web/src/screens/home.tsx"
related_targets: ["apps/web/src/screens/programs.tsx", "apps/web/src/app/app-header.tsx"]
---

# Surface brief: signed-in home + Programs screen

Mode: **Operate**. Shaped with the user 2026-10-29 (OpenSpec `step-4a-program-builder`, task 1.2). The user chose layout A, "Today first", over a single long home.

## Job and audience

The lifter opens the app to train. Almost always they tap the next workout and keep the workout screen open until they finish. Home exists to make that one tap obvious. Resuming is the exception: the app was closed mid-workout, or a workout was left unfinished yesterday. Managing programs is a separate, calmer job, and lives on its own screen.

## Home, top to bottom

1. **Header:** the TANREN wordmark, then quiet text links "Programs" and "History", then the theme toggle.
2. **Unfinished workouts first**, one card each:
   - "Continue Pull A · started yesterday · 2 of 3 exercises logged";
   - primary **Continue**;
   - secondary **Finish & start next**, which finishes it with the sets it has and opens the program's next workout in one action (spec `workout-sessions`, design D15). No separate resume banner.
3. **NEXT**, one card per active program that has no unfinished workout:
   - program and cycle;
   - workout name;
   - exercise count and a one-line preview;
   - **Start <workout>**: copper primary on the first card, quieter on the rest;
   - **Skip**, a quiet secondary action. It asks for a one-tap confirmation naming what moves up ("Skip Legs? Pull A moves up next"), and works offline. It is never shown on a started workout.
4. **YOUR PROGRAMS:** active programs and drafts only, up to about 4 rows (name, status, "Cycle 3" or "Cycle 1 of 8" or "not started"), "+ New program", and "All →" to the Programs screen.
5. **RECENT:** as today, with "History →".

**First run** (no programs): "Start your first program" with **Pick a template** and **Create from scratch**, in place of sections 2–4.

## Programs screen

- **Title row:** "Programs" and **+ New program**. That opens a sheet with three choices: Start from a template, Create from scratch, Copy one of mine. Templates live in the sheet, not on home.
- **Groups:** ACTIVE, DRAFTS, FINISHED, then ARCHIVED (count, collapsed).
- **Rows:** name, length ("open-ended" or "12 cycles"), progress, and a ⋯ menu with Rename, Copy, and Archive or Activate.
- **Inline actions:** drafts show **Activate** and **Edit**. Finished fixed programs show **Run another cycle**.
- **Program detail:** tapping a row opens its cycles 1…N, each opening in the builder. Its layout is shaped with the builder in task 1.3.

## Constraints

- Design system as built (`apps/web/DESIGN.md`).
- Phone first, but the laptop layout is equally real: on wide screens the home sections may sit in two columns, as today's next and recent do.
- WCAG 2.2 AA; targets large enough for chalked hands.
- Skip and Finish & start next are queue writes and must work offline. The rest of the Programs screen needs a connection (operations.md §0.3) and says so when offline.

## Open for later

- Template contents and their presentation may change (the user expects to revisit them).
