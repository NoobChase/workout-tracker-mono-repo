# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Lifters who run a structured program (5/3/1, a PPL split, a coach's
spreadsheet) and log it while they train. They log between sets, mid-workout,
in whatever setting they train in: a home gym with a laptop on the bench and a
little chalk on their hands is as typical as a phone in a basement or hotel gym
with poor signal. Neither the phone-only nor the worst-case gym is the default;
both devices and both settings are first-class.

Planning (building or copying a program) is a separate, calmer job done
outside the workout, on any device.

## Product Purpose

Tanren holds the plan and puts the right numbers in front of the lifter at the
moment they need them: write the program once, log each set quickly (online or
not), and see the work add up. Success is a lifter who logs every set without
the app slowing them down, and who trusts the record as theirs.

## Positioning

- A program, a log, and the proof — no feed, no streaks, no social anything.
- Logging never waits on a network: sets queue in order offline and sync later.
- Bring your own AI: users connect the assistant they already use (MCP server,
  plus a plain-JSON import/export format). Tanren never pays for inference, so
  it never charges for it.
- The user owns their record: export is always available, including after the
  subscription lapses.

## Operating Context

- Used mid-workout, between sets, on a phone or a laptop; hands may be chalked
  or sweaty, attention is split, and signal may be absent.
- Programs are structured as programs → cycles → workouts → exercises → sets.
  Week one is built and copied forward; changing week six never touches week
  five. A session never mutates the plan.
- Weights are entered in the user's default unit (lb or kg).
- US only.

## Capabilities and Constraints

- **Pricing: paid only, after a trial.** During the trial and while
  subscribed, everything is available. When the trial ends without a
  subscription, the account becomes **read-only** and the user can still
  **export** their data. There is no free tier. Price and trial length are
  undecided.
- While lapsed, reads of history and plans stay open, but progression
  analytics and the AI (MCP) connector are locked along with every write.
  Subscribing, billing management and account deletion always work. The
  enforcement rule is `docs/data-model.md` §3.8.
- Progression analytics (cycle-over-cycle, plan-versus-actual adherence);
  warmups and drop sets never count toward the numbers.
- Installable PWA (React + Vite + Tailwind + shadcn/ui), Clerk auth.

## Brand Commitments

- Name: **Tanren** (鍛錬, /tahn·ren/) — 鍛 "to forge, to temper", 錬 "to
  refine, to train"; "the hardening of body and mind through deliberate,
  repeated training." Sign-off line used so far: "Deliberate. Repeated.
  Recorded."
- The kanji belong on the home (marketing) page; they do not need to appear
  throughout the app.
- The home page direction is mockup 7, "Stroke Order"
  (`design/mockups/7-stroke-order.html`). Its stroke-order animation is liked
  but not binding — a better option may replace it.
- Stroke data, wherever used, comes from KanjiVG and carries its CC BY-SA 3.0
  attribution.
- Light and dark themes are both first-class.

## Evidence on Hand

- No users, testimonials, reviews, customer logos, or usage statistics exist.
  Never fabricate them. Charts in marketing must be labelled as demo data.
- Price is not set; show it as TBD rather than inventing a number.
- Mockups and their screenshots: `design/mockups/`, `.impeccable/review/`.

## Product Principles

1. The log never waits — not on the network, not on extra taps.
2. The plan is the plan; deviations are recorded, never silently rewritten.
3. The record is the user's: exportable always, readable even when lapsed.
4. Nothing that pads the numbers or nags — no streak guilt, no social pressure.
5. Honest claims only; nothing on a page that the product can't back.

## Accessibility & Inclusion

Target **WCAG 2.2 AA** (adopted 2026-10-25): sufficient contrast in both
themes, full keyboard operation, screen-reader-labelled controls, target sizes
generous enough for chalked or sweaty hands, and motion (including the stroke
animation) that respects `prefers-reduced-motion`.
