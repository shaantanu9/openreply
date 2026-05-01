# Page-explainer eye-icon system — trust-building "why this page" view per screen

**Date:** 2026-05-01
**Type:** Feature

## Summary

Added a DB-backed page-explainer system. Every primary screen has a
stored row in a new `page_explanations` table answering three trust
questions in plain English: WHY this page exists, WHAT science backs
it, and HOW we touch the user's data (non-technical, trust-building —
deliberately *not* a tour of the code).

Every screen automatically gets an eye-icon button injected into its
topbar via a global helper in `main.js`. Clicking the icon opens
`#/why/<slug>` which renders the explainer card. No per-screen edit
needed — `mountWhyEyeIcon()` runs after every successful route render
and skips routes where it's redundant (welcome, /why itself).

37 explanations seeded by default covering every primary screen.
Custom edits via `set_explanation()` mark the row `touched_by_user=1`
so future seeds preserve them.

## Architecture

- **DB**: `page_explanations` table (slug PK · title · purpose ·
  science · data_source · frameworks_json · citations_json ·
  touched_by_user · updated_at).
- **Python**: `runtime/explanations.py` with `get_explanation()`,
  `list_explanations()`, `set_explanation()`. Auto-seeds on first read;
  user-edited rows survive reseeds.
- **CLI**: `research page-explanation-get --slug X` and
  `research page-explanations-list`.
- **Tauri**: `page_explanation_get` and `page_explanations_list`
  commands.
- **API**: `api.pageExplanationGet(slug)` and `api.pageExplanationsList()`,
  cached for 5 minutes.
- **Routes**: `/why` (index) and `/why/<slug>` (detail).
- **Auto-injection**: `mountWhyEyeIcon()` in `main.js` finds the
  topbar of any rendered screen and injects the eye button — no
  per-screen edits.

## Files Created

- `src/reddit_research/runtime/explanations.py` — 37-entry seed +
  CRUD helpers
- `app-tauri/src/screens/why.js` — index + detail screen + reusable
  `whyButtonHTML(slug)` helper
- `changelogs/2026-05-01_11_page-explainer-eye-icon-system.md`

## Files Modified

- `src/reddit_research/runtime/__init__.py` — re-export
- `src/reddit_research/cli/main.py` — two new Typer commands
- `app-tauri/src-tauri/src/commands.rs` — two new Tauri commands
- `app-tauri/src-tauri/src/main.rs` — handler registration
- `app-tauri/src/api.js` — `pageExplanationGet` + `pageExplanationsList`
  with 5-min cache
- `app-tauri/src/main.js` — `/why` routes, `mountWhyEyeIcon` helper
  called from route() after every render
- `app-tauri/src/lib/tabs.js` — `eye` tab icon for `/why`
- `app-tauri/src/style.css` — `.why-*` styles for the screen + the
  eye button
