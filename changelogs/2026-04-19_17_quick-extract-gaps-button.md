# Quick-extract gaps button (Actions tab)

**Date:** 2026-04-19
**Type:** Feature

## Summary

Adds a "Quick extract gaps" button to the Actions tab of the topic screen. Clicking it runs `reddit-cli research gaps --topic X --json` — no graph build — and renders the 4-category LLM output inline in collapsible sections (Pain points / Feature wishes / Product complaints / DIY workarounds). Each item shows its label, a frequency badge, and the first evidence quote. This is a preview-only path; results are never persisted. A hint label explicitly says "run Build & enrich to persist".

## Changes

- Added `quick_extract_gaps` Tauri command in `commands.rs` (thin bridge to `research gaps --json`)
- Registered `commands::quick_extract_gaps` in `main.rs` handler list after `run_temporal_gaps`
- Added `quickExtractGaps` JS wrapper in `api.js` using plain `invoke` (no cache — LLM call must be fresh)
- Added `renderQuickExtract` helper in `topic.js` that handles error/skipped/empty/parse-error states
- Appended "Quick tools" settings-card to `loadActions()` in `topic.js` with loading state + collapsible panel
- Appended `.quick-extract-panel`, `.quick-extract-section`, `.quick-extract-body`, `.quick-extract-item`, `.quick-extract-title`, `.quick-extract-freq`, `.quick-extract-ev` CSS to `style.css`

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — new `quick_extract_gaps` command
- `app-tauri/src-tauri/src/main.rs` — register handler
- `app-tauri/src/api.js` — `quickExtractGaps` wrapper
- `app-tauri/src/screens/topic.js` — `renderQuickExtract` helper + Quick tools UI in `loadActions`
- `app-tauri/src/style.css` — quick-extract panel styles
