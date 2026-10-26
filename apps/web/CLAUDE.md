# apps/web

React + Vite + Tailwind v4 PWA. Root `CLAUDE.md` rules apply; these are the
package conventions.

## Design system

- **Tokens live in `src/index.css`.** Each color is written once as a
  light/dark pair, `var(--if-light, …) var(--if-dark, …)`; the two space
  toggles stand in for `light-dark()` so Safari before 17.5 still works. They
  are mapped onto shadcn/ui's names (`--background`, `--primary`, `--ring`, …)
  and exposed to Tailwind through `@theme inline`. No raw hex in components.
  One exception, because it must work before any CSS loads: the two `--bg`
  values also appear in `index.html`, in the two `theme-color` meta tags and
  the pre-paint script. Change `--bg` and you change those three spots
  together. `src/ui/theme.ts` reads the computed background, so it never
  holds a copy.
- **Copper is for the primary action and the live set only.** Text on
  `--ghost` must be `--text` (faint and copper fail AA on it). Control
  boundaries use `--edge` (3:1), hairlines use `--line` / `--line-2`.
  Re-check contrast numerically when a token changes; the ratios are noted
  above the tokens.
- **Theme**: follows `prefers-color-scheme`; `ThemeToggle` pins
  `<html data-theme>` and stores it in `localStorage['tanren-theme']`
  (`src/ui/theme.ts`, every storage access in try/catch). A toggle that lands
  on the device's own scheme clears the key, so the device is in control
  again. The inline script in `index.html` applies a stored theme before
  first paint; keep the key and the `tanren-theme-color` meta id in sync. Any
  element can pin its own theme with `data-theme`. If a CSP is ever added,
  that inline script needs its hash.
- **Fonts are self-hosted** from `@fontsource` (offline PWA, never Google
  Fonts): Albert Sans for UI, Geist Mono (`num` utility, tabular) for every
  weight, rep and time. Shippori Mincho B1 is only the two wordmark kanji,
  shipped as the two Fontsource subset files that contain them.
- **Primitives live in `src/ui/`**, shadcn/ui-style (`components.json`, `cn`
  in `src/lib/utils.ts`, `@/` = `src/`). Restyle shadcn components into the
  world when adding them; never ship one stock.
- **Targets**: anything a lifter taps mid-workout is at least 44px (logging
  controls 56px: `Button size="log"`, `NumberStepper`). `Button size="sm"`
  (36px) is for planning and settings screens only, never an in-workout
  control. Nothing anywhere is under 24px.
- **A set line has one grammar**: mono for numerals only (`SetFigures`: weight,
  small unit, ×, reps), words in Albert Sans (`SetStatusText`). Build any
  list of sets from those pieces, cards included.
- **Motion**: `ease-out` is the `cubic-bezier(0.23, 1, 0.32, 1)` token;
  pressables scale to .97 on press. The one exception is `NumberStepper`'s
  − and +: they share the field's hairlines, so their icon scales to .85
  instead of the button. Overlays use keyframes (Radix waits for them).
  The one authored moment is `SetRow` ruling a logged set into place, ≤240ms.
  Nothing moves under `prefers-reduced-motion`.

## Kit

`/design` is the design kit (`src/design/`): every primitive in every state,
both themes. It is **development only**, gated on `import.meta.env.DEV` in
`main.tsx`, so it is absent from the production bundle. No router library.
Its numbers are demo data and say so.

## Tests

- `npm test -w @workout-tracker/web`: Vitest + Testing Library (jsdom) for
  components and hooks, `src/**/*.test.tsx`.
- `npm run test:e2e -w @workout-tracker/web`: Playwright against the dev
  server (`e2e/`), including the kit. Needs `npx playwright install chromium`
  once; not part of CI's `npm test`.
