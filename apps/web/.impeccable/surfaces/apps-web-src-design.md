---
version: 1
slug: "apps-web-src-design"
primary_target: "apps/web/src/design"
related_targets: []
---

# Surface brief: app design system + kit (`apps/web`)

Scope: the in-app design system (tokens, primitives, kit page at `/design`, dev-only). Mode: **Operate**. The marketing home page is a separate Persuade surface whose world (mockup 7) this system inherits.

Audience and job: a lifter mid-workout logging sets between efforts, on a phone or a laptop, chalk on their hands, attention split, signal optional. Planning happens later, calmer, any device.

Constraints: WCAG 2.2 AA in both themes; theme follows the device with a remembered toggle; kanji only in the wordmark lockup; no invented data presented as real — kit samples are labelled demo data.

## Direction contract

THESIS: The training log as a lexicon entry — every set is a ruled, numbered line written in order, like a stroke. Refuses the fitness-app default: neon on black, rings, badges, gradient cards, streak confetti.

OWN-WORLD: Warm near-black `#131210` / warm paper `#f4f1ec`; ink `#f1ebe4` / `#1a1613`; one copper accent (`#d07b4b` dark, `#a04a1d` light) for the live set and the primary action only. Hairline rules (`--line`, `--line-2`) instead of boxes; 8px controls, 12px cards. Albert Sans for UI, Geist Mono tabular numerals for every weight/rep/time, small tracked uppercase labels (`.sc`). Shippori Mincho appears only in the 鍛錬 lockup.

STORY: The lifter sees the prescribed set, confirms it in one tap or adjusts weight/reps with large steppers, and sees it ruled into the log — "logged", "queued, no signal", or "failed, retrying" — without ever waiting.

FIRST VIEWPORT: Kit page opens on a live set row at phone width: exercise name, set "3 / 5", Geist Mono 225 × 5 at display size, two 56px steppers, full-width copper "Log set" button within thumb reach; theme toggle top right. Below, every primitive in every state, light and dark side by side on desktop.

FORM: Pinned by the user — mockup 7 "Stroke Order" (`design/mockups/7-stroke-order.html`), extended to Operate. No concept-seed run: a user-pinned direction beats the roll. Signature interaction: logging a set "rules" it into place — the row settles and its index strokes in copper, once, ≤240ms, ease-out, off under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- The logger screen's layout and the workout source are decided in the step-3 OpenSpec proposal, not here.
