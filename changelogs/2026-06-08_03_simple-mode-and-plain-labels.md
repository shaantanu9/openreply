# Lever 2 + 3 — Simple Mode (grouped nav) + plain labels

**Date:** 2026-06-08
**Type:** UX Enhancement

## Summary

Levers 2 and 3 of the "make the app understandable for non-technical beta users" effort.
**Simple Mode** (default ON) collapses the ~30-item sidebar down to the core essentials
(Dashboard, Topics, Find, Audience, Reports, Help, Settings + Research/Library in Research
mode) and tucks everything else behind an **"Advanced tools"** expander — directly
addressing the #1 confusion: too many screens with no clear starting point. A
**"Simple mode: On/Off"** toggle in the Account section lets power users switch to the full
nav anytime. Plus plain-language **renames** of the most jargon-y nav labels.

## Changes

- **`lib/simpleMode.js`** (new): tags non-essential nav links `data-tier="advanced"` by
  route at boot (no risky HTML rewrite); hides them in Simple Mode via CSS; injects an
  "Advanced tools" expander after the essentials and a "Simple mode" toggle in Account;
  also hides section labels (e.g. Agents) whose items are all advanced. Default ON
  (unset → on); choice + expander state persisted in localStorage.
- **`main.js`**: `initSimpleMode()` at boot (after the help popover).
- **`style.css`**: Simple Mode hiding rules, the advanced-toggle button, and rail-mode
  collapse behavior.
- **`index.html`** (Lever 3 renames): "Task Manager" → "Activity Monitor", "OST" →
  "Opportunity Tree", "PMF Survey" → "Product-Market Fit", "Launch & GTM" → "Launch Plan",
  "Iterate" → "Auto-tune" (matching the plain explainer titles from Lever 1).

## Files Modified

- `app-tauri/src/lib/simpleMode.js` (new)
- `app-tauri/src/main.js`, `app-tauri/src/style.css`, `app-tauri/index.html`

## Verification

- `node --check` clean; `npm run build` succeeded; live dev server confirmed serving the
  new bundle with `initSimpleMode` / "Advanced tools" / "Simple mode: On" present.
- Full JS suite: 52/52 pass.
- Nav dependencies preserved: active-class + `data-nav-mode` research gating work
  positionally; `#nav-workspace` id kept for the onboarding overlay CSS.

## Notes / follow-ups

- Essential items keep their existing DOM order (collapse with no gaps); a future polish
  could reorder them into the strict ① Research → ② Read → ③ Audience → ④ Write sequence.
- More jargon screen-titles can be renamed over time; explainer titles already updated in
  Lever 1.
