---
version: 1
slug: "apps-web-src-landing"
primary_target: "apps/web/src/landing"
related_targets: ["apps/web/src/ui/wordmark.tsx", "design/mockups/7-stroke-order.html"]
---

# Surface brief: landing page (signed-out `/`)

Mode: **Persuade**. Shaped with the user 2026-10-29 (OpenSpec `step-4a-program-builder`, task 1.1; spec `landing-page`). Version 1 is deliberately light: the user expects to revise it once the signed-in screens (home, builder, templates, logger) are settled.

## Job and audience

A lifter who runs a program arrives from a link or a search, deciding whether Tanren is worth signing up for. Success is that they understand "plan once, log each set in a tap, signal or not" and select **Get started**. Returning lifters sign in with **Log in**.

## Direction

Visual authority: mockup 7 "Stroke Order" (`design/mockups/7-stroke-order.html`) and `apps/web/DESIGN.md`. Keep the mockup's structure, typography, copper accent and hairline rules. The changes below are the user's.

1. **Header: wordmark is "TANREN" only, no kanji.** The same applies to the app header: `src/ui/wordmark.tsx` drops 鍛錬 everywhere. An icon or mark may come later (it's also needed for the PWA icon); none for now. The kanji live only in the hero and the closing lockup.
2. **Hero stays:** big 鍛錬 with the stroke-order draw and the dictionary entry (pronunciation, the meaning of each character, *noun* definition). The animation is kept for now, though the user isn't fully sold on it. It respects `prefers-reduced-motion`, which shows the finished characters.
3. **Add an offline demo loop** in "Repeat the work", replacing its static card. It shows in a slow cycle:
   - sets logging while online;
   - signal dropping;
   - new sets ruling in as "waiting";
   - signal returning, and the waiting sets syncing in order.

   Built from the design system's real `SetRow` and `SyncStatus` look, it's the page's second signature moment after the strokes. It pauses offscreen and under reduced motion, where it shows a single still frame of the "waiting → synced" state.
4. **"Coming soon" labels, never presented as available:**
   - "See it harden" (analytics, step 4d);
   - "Swap an exercise and the plan stays the plan" (step 4c);
   - the whole "Your AI" section (MCP step 6, JSON import/export step 4b);
   - pricing (step 5).
5. **Pricing stays visible as TBD:** no dollar amounts and no "Subscribe" button. The trial card's call to action is **Get started** (sign-up).
6. **Footer:** drop "Mockup 7 · Stroke Order". Keep "Tanren · US only" and the KanjiVG CC BY-SA 3.0 credit.
7. **Section labels on phones:** hidden below the desktop margin layout (user, 2026-10-30); "Coming soon" badges stay.

## Calls to action

- "Get started", "Start training" and the trial card open Clerk sign-up at `/sign-up`.
- "Log in" opens sign-in at `/sign-in`.
- "How it works" scrolls to the "Three things" section.
- After either flow, the visitor lands on the app home.

## Constraints

- No Clerk or app bundle before first paint (design D2).
- WCAG 2.2 AA in both themes; theme toggle as in the mockup.
- Phone width with no horizontal scroll.
- No testimonials, logos, user counts or invented numbers. The bar chart keeps its "demo data" label.

## Deferred (not in version 1)

- The AI chat as a looping animation of someone chatting with an assistant. The user wants it, but not now.
- A real app screenshot, a "start from a template" section, a "fair questions" block, and a line from the user on why they built it. To be revisited after the other screens are designed.
- A brand logo or icon. The user intends to get one to replace the kanji as the brand mark; where it appears is decided when it exists.
