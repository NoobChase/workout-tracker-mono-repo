---
name: Tanren
description: A training log written like a lexicon entry, one ruled, numbered line per set.
colors:
  copper-light: "#a04a1d"
  copper-dark: "#d07b4b"
  copper-btn-light: "#a04a1d"
  copper-btn-dark: "#ab5428"
  on-copper: "#fff7f1"
  bg-light: "#f4f1ec"
  bg-dark: "#131210"
  card-light: "#ebe6df"
  card-dark: "#1b1916"
  ghost-light: "#e2dcd3"
  ghost-dark: "#2a2622"
  line-light: "#d9d1c7"
  line-dark: "#2d2924"
  line-2-light: "#c4b9ad"
  line-2-dark: "#3e3832"
  edge-light: "#8c8278"
  edge-dark: "#6e655c"
  text-light: "#1a1613"
  text-dark: "#f1ebe4"
  muted-light: "#574f48"
  muted-dark: "#a79e95"
  faint-light: "#6a6159"
  faint-dark: "#91877e"
  danger-light: "#b0302a"
  danger-dark: "#ec7a72"
  scrim-light: "rgb(26 22 19 / 0.38)"
  scrim-dark: "rgb(0 0 0 / 0.6)"
typography:
  display:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "min(64px, 15vw)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "\"tnum\""
  headline-page:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title-sm:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1
  meta:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label-sc:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.14em"
  label-sc-sm:
    fontFamily: "Albert Sans Variable, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.14em"
  figures:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 400
    fontFeature: "\"tnum\""
  figures-stepper:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "\"tnum\""
  mark:
    fontFamily: "Tanren Mark, serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1
rounded:
  sm: "6px"
  md: "8px"
  xl: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "9": "36px"
components:
  button-primary:
    backgroundColor: "{colors.copper-btn-light}"
    textColor: "{colors.on-copper}"
    rounded: "{rounded.md}"
    padding: "0 22px"
    height: "48px"
  button-log:
    backgroundColor: "{colors.copper-btn-light}"
    textColor: "{colors.on-copper}"
    rounded: "{rounded.md}"
    padding: "0 24px"
    height: "56px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-light}"
    rounded: "{rounded.md}"
    padding: "0 22px"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-light}"
    rounded: "{rounded.md}"
    padding: "0 22px"
    height: "48px"
  button-ghost-hover:
    backgroundColor: "{colors.ghost-light}"
    textColor: "{colors.text-light}"
  button-sm:
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.text-light}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "48px"
  number-stepper:
    textColor: "{colors.text-light}"
    typography: "{typography.figures-stepper}"
    rounded: "{rounded.md}"
    height: "56px"
  card:
    backgroundColor: "{colors.card-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.xl}"
    padding: "16px"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.muted-light}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "24px"
  set-row:
    textColor: "{colors.text-light}"
    typography: "{typography.figures}"
    height: "52px"
  overlay:
    backgroundColor: "{colors.bg-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.xl}"
    padding: "24px"
---

# Design System: Tanren

## Overview

**Creative North Star: "The Ruled Ledger"**

Tanren's app world is the training log written as a lexicon entry: every set is a ruled, numbered line, written in order, the way a character is written stroke by stroke. Warm paper and warm near-black carry ink-colored type; hairline rules divide content instead of boxes; one copper accent marks the set happening now and the action that logs it. The surface is quiet so the numbers are loud: weights, reps and times sit in tabular mono at sizes a lifter can read from a bench.

Density is set by the gym, not the desk. Anything tapped mid-workout is a large target (44px floor, 56px for logging), the primary action sits in thumb reach, and nothing waits on the network: a set's state ("logged", "queued, no signal", "failed, retrying") is written into its line in words. Both themes are first-class and follow the device unless the lifter pins one.

The world comes from the home-page mockup "Stroke Order" (`design/mockups/7-stroke-order.html`). It rejects the fitness-app default: neon on black, progress rings, badges-as-rewards, gradient cards, streak confetti.

**Key Characteristics:**
- Warm paper / warm near-black, ink type, a single copper accent.
- Ruled lines, not boxes; cards only where rows group, never nested.
- Mono tabular numerals for every weight, rep and time; words in Albert Sans.
- Large, flat, hairline-edged controls; press scales to .97.
- One authored motion: a logged set is ruled into place, once, in 240ms or less.

## Colors

A warm, near-monochrome ink-and-paper palette with one copper voice. Every color ships as a light/dark pair (the `-light` / `-dark` tokens above), written once in `src/index.css` and resolved per theme.

### Primary
- **Forge Copper** (copper-light / copper-dark): the live set (its index, "now" label, the current set number) and focus rings, caret and selection. Text-safe (at least 4.8:1) on bg and card in both themes.
- **Copper Fill** (copper-btn-light / copper-btn-dark): the primary button fill only. Darker than Forge Copper in dark theme so On-Copper text clears 4.9:1. Hover deepens it by mixing 14% black in OKLab.
- **On-Copper** (on-copper): text and icons on the Copper Fill; one value for both themes.

### Neutral
- **Warm Paper / Warm Night** (bg-light / bg-dark): the page and overlay surface.
- **Card Stock** (card-light / card-dark): one step off the page, for cards only.
- **Ghost Wash** (ghost-light / ghost-dark): the hover/press fill of ghost buttons, stepper buttons and close buttons. Only `--text` sits on it.
- **Hairline** (line-light / line-dark): the rule between set rows, card borders, section dividers, empty-state lines.
- **Strong Hairline** (line-2-light / line-2-dark): secondary-button and badge borders, overlay and toast edges, header rule under the exercise name.
- **Edge** (edge-light / edge-dark): the boundary of an input or stepper field, at least 3:1 so a field is findable; dashed on warmup/drop badges.
- **Ink** (text-light / text-dark): all primary text and logged set numerals.
- **Muted Ink** (muted-light / muted-dark): labels, descriptions, status words, units and the × sign.
- **Faint Ink** (faint-light / faint-dark): planned-set indices, placeholders, disabled stepper icons, meta lines. Still 4.8:1 on bg and card.
- **Danger** (danger-light / danger-dark): invalid field borders, error text, failed-and-retrying sync and set states. Never a fill.
- **Scrim** (scrim-light / scrim-dark): the overlay backdrop under dialogs and sheets.

### Named Rules
**The One Copper Rule.** Copper means "this set, now" or "do it". It fills only the primary action and colors only the live set, plus the system-level focus ring, caret and selection. Badges, units, charts-in-app and status chips stay in ink.

**The Ghost Ground Rule.** On the Ghost Wash, text is Ink. Faint Ink and copper fall below 4.5:1 there.

**The Paired Token Rule.** A color exists as a light/dark pair in `src/index.css` or not at all. No raw hex in components; changing `--bg` also changes the two `theme-color` metas and the pre-paint script in `index.html`.

## Typography

**Display Font:** Albert Sans Variable (with system-ui, sans-serif)
**Body Font:** Albert Sans Variable (with system-ui, sans-serif)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, monospace), tabular figures
**Mark Font:** Shippori Mincho B1 at 800, aliased "Tanren Mark", subset to the two wordmark kanji

**Character:** A plain, warm grotesque for words and an engineered mono for numbers. The mono carries the display role because the biggest thing on a logging screen is a number. All faces are self-hosted from Fontsource, so the installed PWA renders the same offline.

### Hierarchy
- **Display** (mono 500, min(64px, 15vw), 1, -0.03em): the prescribed weight × reps of the live set. The unit drops to 0.3em in Muted Ink, and the × is muted too.
- **Page Headline** (700, 32px from md, 28px on phones, tight, -0.02em): the one h1 of a page ("What's next", "History", a session's workout name).
- **Headline** (700, 28px, tight, -0.02em): the exercise name above the live set.
- **Title** (700, 20px, -0.01em, balanced): dialog and sheet titles.
- **Title Small** (600, 17px, 1.375): card titles, empty-state titles, and section headings in sentence case with their count beside them ("Today's log", "2 of 15 planned sets"; "Recent workouts").
- **Body** (400, 16px, 1.6): default text and inputs. Body Small (15px) is for descriptions; prose holds at 48 to 60ch.
- **Label** (500, 14px, sentence case, Muted Ink): form and stepper labels.
- **Meta** (400, 13px, 1.4, Muted Ink): a set's status words, row values and counts at the right of a ruled line, the sync line, and the wordmark's "TANREN" (at 700, 0.22em).
- **Small Caps Label** (600, 11px, 0.14em, uppercase): only the live "now" marker (copper) and set-kind badges (muted). Never a section heading, eyebrow or kicker: a section is named by a sentence-case Title Small heading. The 12px step is kept for the marketing page.
- **Figures** (mono 400, 15px, tabular): every set line. The stepper value is mono 500 at 26px.

### Named Rules
**The Numbers Are Mono Rule.** Every weight, rep, time and set index is Geist Mono with tabular figures, so 95 → 100 never shifts. Words never are: status text, labels and units-as-words stay in Albert Sans.

**The One Set Grammar Rule.** A set reads weight, small unit, ×, reps, in that order, everywhere: log, card, toast. Build it from the shared set-figures piece; never retype it.

**The Kanji Stay Home Rule.** 鍛錬 and Shippori Mincho appear only in the wordmark lockup (20px kanji, 13px "TANREN" at 700 with 0.22em tracking).

## Layout

Single column at phone width; on desktop the live set (up to 26rem) and the log sit side by side with a 64px gutter. Home uses the same split when there is a program to train: what's next (up to 26rem) at left, recent workouts at right with the History link seated on its heading. In the log, each exercise's heading is itself a ruled row (52px floor, the name seated on its Hairline) so the log reads as one ledger with no unexplained gaps. Content containers cap at 1280px with 16px side padding, 36px from the md breakpoint. Spacing is the Tailwind 4px scale, used in a short rhythm: 8 and 12px inside rows, 16 to 20px between fields and inside cards, 24 to 40px between sections. Rows have a 44px floor (set rows 52px). The primary logging action is full width at the bottom of its column, inside thumb reach; toasts therefore land at the top. Sheets rise from the bottom (max 85dvh, max-width 36rem) and pad for the safe-area inset.

**The Thumb Floor Rule.** Anything a lifter taps mid-workout is at least 44px; logging controls are 56px. The 36px small button is for planning and settings screens only. Nothing anywhere is under 24px.

## Elevation & Depth

Flat by default. Depth on the page is tonal (Card Stock one step off the paper) and linear (hairlines), never shadowed. Shadows appear only on things that float above the page: dialogs, sheets and toasts, as one soft, low-opacity drop built on a theme-aware shadow color (rgb(26 22 19 / 0.14) light, rgb(0 0 0 / 0.5) dark).

### Shadow Vocabulary
- **Dialog** (`box-shadow: 0 24px 48px -12px var(--shadow)`): centered dialogs.
- **Sheet** (`box-shadow: 0 -16px 40px -16px var(--shadow)`): bottom sheets, cast upward.
- **Toast** (`box-shadow: 0 12px 32px -12px var(--shadow)`): toasts.

### Named Rules
**The Only Floaters Cast Rule.** If it does not sit above a scrim or over the page, it has no shadow. Cards, buttons and fields are flat.

## Shapes

Gently rounded, never pill. Controls use 8px corners, badges 6px, cards, overlays and toasts 12px; sheets drop their bottom corners and bottom border to meet the screen edge. Borders are 1px throughout: Hairline for rules, Strong Hairline for quiet control edges, Edge for input boundaries. A dashed border carries meaning, and only these two: on a badge it marks a set that does not count (warmup, drop), and in an empty state it draws the blank lines sets will land on. Nothing else is dashed; a panel that is merely secondary is a plain Hairline. A number not entered yet is drawn as a short solid Edge rule on the baseline (BlankFigure), a blank to fill, never a dash, which reads as a minus. Icons are Lucide line icons at 1.75 stroke, 14 to 20px.

## Components

### Buttons
Flat, hairline-edged, confident; the press is felt, the hover is quiet.
- **Shape:** gently rounded (8px), 1px border, semibold label.
- **Primary:** Copper Fill with On-Copper text. Three heights: 48px default, 56px "log" for in-workout actions (full width), 36px small for planning screens.
- **Secondary (default):** transparent with a Strong Hairline border and Ink text; hover lifts the border to Muted Ink.
- **Ghost:** borderless Muted Ink text; hover fills with Ghost Wash and turns Ink.
- **Destructive:** transparent, Strong Hairline border, Danger text; hover turns the border Danger.
- **States:** press scales to .97 over 160ms ease-out; hover only on devices that hover; disabled at 45% opacity; loading keeps width and label (hidden) under a spinner and sets aria-busy. Icon buttons are 44px square.

### Badges
- **Style:** 24px tall, 6px corners, no fill, never copper.
- **Variants:** warmup and drop are small-caps labels (11px) with a dashed Edge border, meaning "does not count"; unit badges are mono 12px with a Strong Hairline border; neutral is 12px medium.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Card Stock, one Hairline border.
- **Shadow Strategy:** none (see Elevation).
- **Internal Padding:** 16px, 16px gap. Rows inside are ruled with Hairlines (44px min), label left and muted 13px value right. A footer is separated by a Hairline rule. Never nest a card.

### Inputs / Fields
- **Style:** 48px tall, transparent, 8px corners, 1px Edge border, 16px text, 14px side padding.
- **Focus:** border turns Forge Copper, plus the global 2px copper outline at 3px offset on keyboard focus.
- **Error / Disabled:** Danger border with aria-invalid (message text is Danger, 14px, below); disabled at 45% opacity.

### Number Stepper
The logging control. A 56px field with an Edge border: a 56px − button, the number typed directly in mono 26px with its unit in muted mono 14px, and a 56px + button, divided by Hairlines. The buttons fill with Ghost Wash on hover and press, and their icons (not the buttons) scale to .85. Arrow keys step once; Page Up/Down five times. Out-of-range input turns the border Danger until blur clamps it.

### Set Row (signature)
One ruled, numbered line of the log: a 40px mono index column, the set figures (plus a kind badge), and the status in words at the right, on a 52px minimum row with a Hairline beneath. Planned rows have a Faint index and muted figures; the live row has a copper index and the copper small-caps "now"; logged rows are Ink with a check and "logged" in Muted Ink; queued rows say "queued, no signal" or "queued, in order"; failed rows say "failed, retrying" in Danger; rejected rows (the server refused the set for good) say "rejected" in Danger with a ban icon, and carry the server's reason on a second line in Danger under the figures. A live or planned row with no weight yet shows a BlankFigure in its place. A logged row can be one pressable line (52px, a pencil at the end, its press a .985 scale) that opens the set to edit or delete; it is named in full for assistive tech ("Set 2, 225 lb for 5 reps, logged. Edit"). When a set is logged, the line settles 3px, a copper stroke runs along its rule from the index outward, and a copper copy of the index draws in and cools to ink, all within 240ms, once, ease-out, and not at all under reduced motion.

### Sync Status
A 32px live-region pill with 8px corners, a Strong Hairline border and a 14px line icon, stating the queue in one line, counted in sets, never raw writes ("All sets synced", "2 sets queued, no signal"); a start or finish waiting alone reads as the workout ("Workout queued, no signal"). Six states: synced, syncing and offline in Muted Ink; failed-and-retrying and rejected ("A set was rejected, its workout stopped syncing", or "A workout was rejected and stopped syncing" for a start or finish; ban icon; one lane per workout, so others keep syncing) in Danger; on hold ("Sync on hold", pause icon) in Muted Ink, because waiting for the right account to sign in is not an error.

### Sync Alert
When a workout's writes have stopped (a rejection) or are on hold, the pill alone isn't enough. The queue runs one lane per workout, so this stops only that workout; the band names it. A band spans the page under the header, ruled off by a Hairline: one line naming the write in the lifter's terms ("Set 2 of Overhead Press wasn't saved:", semibold Danger), the server's reason in Ink, and "The rest of Push waits behind it on this device; other workouts still sync" in Muted Ink; then its actions at 48px: "Try again" leads (a secondary button: it resends the write as it was, the one recovery the queue offers until step 5), and a ghost "Show set" (or "Show workout") link follows unless that is already on screen. When the refusal is about the account (not entitled), the muted line says what is true today instead of offering a control that doesn't exist: subscribing comes with billing, and once the account is renewed, try again; until then the rest of that workout stays on this device (it does not promise other workouts sync, since the same account refuses them too). On hold shows the reason and "Nothing is lost: Push waits on this device." It is an alert region and appears on every screen.

### Overlays (Dialog, Sheet, Toast)
Paper surface, Strong Hairline edge, 12px corners, the matching floater shadow. Dialogs are for decisions that need protected focus (max 28rem, 24px padding) and scale in from 0.97 over 200ms, leaving in 150ms. Sheets rise from the bottom on the drawer curve (cubic-bezier(0.32, 0.72, 0, 1), 300ms in, 200ms out). Close buttons are 44px ghost squares at top right. Toasts sit at the top center, max 24rem, with a 44px action.

### Navigation
The header is a 64px bar with a Hairline beneath: the wordmark at left (a link home), and at right the sync status, the theme toggle (a 44px secondary-style control that names the theme showing, with a half-filled circle glyph) and the account control (a 36px Card Stock square with a Strong Hairline edge and the Lucide user glyph in Ink, inside a 44px target; never the account provider's generated avatar). On a phone the sync status takes its own row under the bar, inside the header. Pages below it open with a 44px back arrow (ghost) beside the page's heading where there is somewhere to go back to.

### Empty State
Three blank lines with dashed Hairlines, numbered 1 to 3 in Faint mono, above a 17px title, a muted description and its action. The empty log already shows how sets will land.

## Do's and Don'ts

### Do:
- **Do** keep copper on the primary action and the live set; everything else is ink, muted ink or a hairline.
- **Do** set every weight, rep, time and index in Geist Mono tabular figures, and compose set lines from the shared weight / unit / × / reps grammar.
- **Do** separate rows with 1px Hairlines and group them in a 12px Card Stock card only when they belong together.
- **Do** give in-workout controls 56px (logging) or at least 44px, and keep the primary action within thumb reach.
- **Do** write sync and set state in words next to an icon ("queued, no signal"), never in color alone.
- **Do** use Edge (at least 3:1) for field boundaries and recheck contrast numerically in both themes when a token changes.
- **Do** press-scale pressables to .97 with the ease-out curve (cubic-bezier(0.23, 1, 0.32, 1)) and keep overlay exits faster than entries; stop all motion under prefers-reduced-motion.

### Don't:
- **Don't** use neon on black, progress rings, reward badges, gradient cards or streak confetti.
- **Don't** put copper on badges, units, status pills or decorative accents in the app.
- **Don't** nest cards, or box individual rows that a hairline can rule.
- **Don't** shadow anything that doesn't float above the page.
- **Don't** use the tracked small-caps style for form labels, section headings, eyebrows or kickers; labels are sentence case at 14px, section headings sentence-case Title Small. Small caps are the "now" marker and the set-kind badges only.
- **Don't** show the kanji or Shippori Mincho outside the wordmark lockup.
- **Don't** use the 36px small button for anything tapped mid-workout.
- **Don't** ship a shadcn/ui component stock; restyle it into these tokens first.
- **Don't** bring the home page's marketing devices into the app: the stroke-order kanji diagram, copper emphasis inside headings, and copper small-caps labels belong to the Persuade surface (mockup 7), not to Operate screens.
