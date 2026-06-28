# GUI consistency primitives — PageShell / EmptyState / ErrorCard / LoadingSkeleton + 8pt spacing scale

**Date:** 2026-05-24
**Type:** Feature

## Summary

Phase 1 of the GUI consistency pass spec'd in
`docs/superpowers/specs/2026-05-18-gui-consistency-design.md`. The Tauri app had
no spacing scale and ~1,142 hardcoded `padding`/`margin` px values bypassing the
token system, and every screen hand-rolled its own page header, empty state,
loading state, and error display. This change lays the foundation: an 8pt
spacing scale + extended type scale in `:root`, four shared layout primitives
with tests, and a CI guard that ratchets the hardcoded px count strictly
downward as screens migrate.

No visual look change — the existing semantic tokens (`--page-pad-x`,
`--block-gap`, etc.) are re-expressed in terms of `--space-N` and each value
shifts by ≤4px, imperceptible per-value. Screens that already use the semantic
tokens are unaffected beyond the snap.

## Changes

- **`style.css` `:root`**
  - Added 8pt spacing scale: `--space-1` (4px) through `--space-8` (64px).
  - Extended the type scale: added `--fs-12`, `--fs-14`, `--fs-17`, `--fs-20`,
    `--fs-24` (existing `--fs-11`, `--fs-13`, `--fs-15` preserved).
  - Re-expressed existing page-rhythm tokens as `var(--space-N)` aliases —
    each shifts ≤4px to land on the grid; existing token names stay valid.
- **`src/components/PageShell.js`** — `pageShell({ title, subtitle?,
  actionsHtml?, bodyHtml })` returns the standard page container with a uniform
  `PageHeader` (title left, action buttons right, optional subtitle). One
  header for every screen.
- **`src/components/EmptyState.js`** — `emptyState({ icon?, title, message?,
  ctaHtml? })`. Consolidates the two current empty-state helpers behind one
  API; old modules will become thin re-export shims as screens migrate.
- **`src/components/ErrorCard.js`** — `errorCard({ title?, message, retryHtml?
  })`. Token-driven error display; replaces ad-hoc red-toned `<div>`s scattered
  across screens.
- **`src/components/LoadingSkeleton.js`** — `loadingSkeleton({ rows?,
  height? })`. Animated skeleton block aligned to the spacing scale; replaces
  hand-rolled `<div>` placeholders.
- Each primitive ships with a `*.test.mjs` node:test file covering escaping,
  optional fields, and DOM-string shape.
- **`scripts/check_css_consistency.sh`** — counts hardcoded `padding`/`margin`
  px in `style.css` and fails CI if the count rises above CEILING. Baseline
  CEILING=1142 (the count at the start of the migration). Lower the ceiling
  as each screen batch lands; never raise it.
- **`package.json`** — `npm test` now runs the four new component tests
  alongside the existing suite.
- **CSS class definitions** for the four primitives appended to `style.css`
  (~95 new lines, all token-driven).

## Files Created

- `app-tauri/src/components/PageShell.js`
- `app-tauri/src/components/PageShell.test.mjs`
- `app-tauri/src/components/EmptyState.js`
- `app-tauri/src/components/EmptyState.test.mjs`
- `app-tauri/src/components/ErrorCard.js`
- `app-tauri/src/components/ErrorCard.test.mjs`
- `app-tauri/src/components/LoadingSkeleton.js`
- `app-tauri/src/components/LoadingSkeleton.test.mjs`
- `app-tauri/scripts/check_css_consistency.sh`
- `docs/superpowers/specs/2026-05-18-gui-consistency-design.md`
- `changelogs/2026-05-24_01_gui-consistency-primitives.md`

## Files Modified

- `app-tauri/src/style.css` — added spacing/type scales in `:root`, re-aliased
  page-rhythm tokens, appended primitive class definitions.
- `app-tauri/package.json` — registered the four new `*.test.mjs` files in the
  `test` script.

## Next steps

Phase 2 migrates the 44 screens onto `pageShell()` / `emptyState()` /
`errorCard()` / `loadingSkeleton()` in batches; each batch ratchets the
CEILING in `check_css_consistency.sh` downward toward 0.
