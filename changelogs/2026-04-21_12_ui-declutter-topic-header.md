# UI declutter — topic-page header from 3 rows to 2

**Date:** 2026-04-21
**Type:** UI Enhancement — visual density

## Summary

Topic page had **7 rows of chrome** before any content: breadcrumb +
topbar with chips + buttons row + H1/subtitle row + stepper + phase
card + tabs. Folded the 3-row top block into a dense 2-row compact
header. Saves ~140 px above the fold (~15 % of a 1440×900 viewport).

Zero JS logic changes — only markup restructure + scoped CSS.

## What changed visually

### Before

```
┌─────────────────────────────────────────────────────────────┐
│ Workspace / strong-topic-name      •Collecting… [Cancel]... │ ← topbar row
│ [⟳ Rerun collect] [⇄ Compare] [Delete]                     │ ← buttons row
│ Workspace › ... › Act › Concepts                            │ ← breadcrumb
│ # meditation and sound frequency brainwave app              │ ← H1
│   Loading topic…                                            │ ← subtitle
└─────────────────────────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────────────────────────┐
│ ← Workspace  Topic Name  [•Collecting]  stats  •••  [Rerun] [Compare] [🗑] │
│ last-collect meta · path                          [LLM pill] [Auto-refresh] │
└─────────────────────────────────────────────────────────────┘
```

## What shipped

- `.topic-header-compact` wrapper with 2 rows
- Row 1: back-link, bold inline title, status chip, stat chips, bet
  pill, action buttons (Rerun / Compare / Delete-icon)
- Row 2: secondary meta line (the former `#topic-sub`), LLM pill,
  Auto-refresh compact toggle
- "Loading topic…" placeholder removed (was conflicting with the
  Collecting chip)
- Breadcrumb collapsed to a single `← Workspace` affordance
- Delete button shrunk to icon-only with hover tooltip
- Auto-refresh toggle restyled from bordered-box to compact pill
- Dark-mode overrides included
- Responsive collapse at 900 px — title + meta truncate with ellipsis

## Scope

Topic page ONLY this pass. Product Dashboard (`screens/product.js`)
and Compare view (`screens/compare.js`) have the same pattern; they're
noted for follow-up in the strategy doc.

## Files Created

- `docs/ops/ui-declutter-2026-04-21.md` — why/what/how + rule-of-thumb
  for future header additions ("header chrome should never exceed 180
  px")
- `changelogs/2026-04-21_12_ui-declutter-topic-header.md`

## Files Modified

- `app-tauri/src/screens/topic.js` — header markup block rewritten
  (lines ~364–392), all IDs preserved
- `app-tauri/src/style.css` — new `.topic-header-compact` block at end
  (~100 lines), scoped so no other screen shifts
