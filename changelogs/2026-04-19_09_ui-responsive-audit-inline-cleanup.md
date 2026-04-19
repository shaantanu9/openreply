# UI responsiveness audit: utility button classes, grid minmax fixes, accessibility

**Date:** 2026-04-19
**Type:** UI Enhancement + Refactor

## Summary

Full-app UI audit after user flagged "setting and all other ui is still not responsive and not proper". Swept all 9 screens to replace ad-hoc inline button styles (45+ occurrences of `style="padding:8px 14px;font-size:12px..."`) with reusable utility classes, applied the `tauri-python-sidecar-app` skill's Phase 7 `minmax(0, 1fr)` pattern to every multi-column grid that could squish a sibling cell, fixed overflow in `.kv-row` and `.settings-profile-head`, and closed the settings stale-route race. Also added aria-labels / focus traps to improve keyboard + screen-reader UX.

## Changes

### New CSS utility classes (in style.css)
- `.btn-sm` — `padding: 8px 14px; font-size: 12px`
- `.btn-xs` — `padding: 6px 10px; font-size: 11px`
- `.btn-bordered` — `border: 1px solid var(--line)` (typically composed with `.btn-ghost`)
- `.btn-danger` — destructive red background
- `.btn-danger-ghost` — destructive ghost with pink border + red text

### Inline style sweep (all replaced with utility classes)
- `settings.js` — 14 buttons
- `home.js` — 3 buttons
- `welcome.js` — 5 buttons
- `science.js` — 2 buttons
- `byok.js` — 12 buttons (includes `7px 12px` provider-row variant)
- `topic.js` — 10 buttons (map actions, chat send/cancel, danger-zone delete)
- `reports.js` — 5 buttons
- `collect.js` — 2 icon buttons
- `database.js` — 1 button
- `ingest.js` — 1 button

### Responsive grid fixes (Phase 7 battle-tested pattern)
Applied `minmax(0, 1fr)` so cells shrink below intrinsic width instead of overflowing:
- `.stat-grid` → `repeat(4, minmax(0, 1fr))`
- `.topic-grid` → `repeat(auto-fit, minmax(min(260px, 100%), 1fr))` (was fixed 4 cols)
- `.settings-profile-fields` → `repeat(2, minmax(0, 1fr))`
- `.hero` → `minmax(0, 1.4fr) minmax(0, 1fr)`
- `.two-col` → `minmax(0, 1.5fr) minmax(0, 1fr)`
- `.ingest-wrap` → `minmax(0, 1.6fr) minmax(0, 1fr)`
- `.db-grid`, `.reports-layout` → `<fixed>px minmax(0, 1fr)`

### Flex `min-width: 0` overflow fixes
- `.kv-row` — gap + baseline alignment; `span` now truncates with ellipsis (no more file-path overflow in Settings → Data card)
- `.settings-profile-head` — inner `div` shrinks cleanly; h4 / p truncate instead of overflowing the card

### Real bug fixes
- **Settings stale-route race** — every async card fill (`fillLlmCard`, `fillRedditCard`, `fillDataCard`, `fillTablesCard`) now guarded by `alive()` that checks `root.dataset.routeGen` + `root.isConnected`. Also dedup'd the double `api.byokStatus()` call into one.
- **Ingest empty topic selector** — when `listTopics()` throws, now shows `⚠ couldn't load topics: <msg>` as a disabled option instead of silently empty.
- **Progress log height** — now scales with viewport: `min-height: 320px; max-height: max(320px, calc(100vh - 480px))`. Was fixed at 440px.

### Accessibility
- **Aria-labels on icon-only buttons** — `#btn-copy-log`, `#btn-clear-log`, `.byok-model-delete`.
- **Modal focus traps** — new-topic modal (main.js) and BYOK modal (byok.js) now trap Tab + Shift+Tab inside; first focusable element auto-focused on open; focus restored to previously-focused element on close.

## Files Modified

- `app-tauri/src/style.css` — utility classes + grid minmax + overflow fixes
- `app-tauri/src/main.js` — new-topic modal focus trap + focus restore
- `app-tauri/src/screens/settings.js` — stale-route guard + inline styles
- `app-tauri/src/screens/home.js` — inline styles
- `app-tauri/src/screens/welcome.js` — inline styles
- `app-tauri/src/screens/science.js` — inline styles
- `app-tauri/src/screens/byok.js` — inline styles + focus trap + aria-labels
- `app-tauri/src/screens/topic.js` — inline styles
- `app-tauri/src/screens/reports.js` — inline styles
- `app-tauri/src/screens/collect.js` — inline styles + aria-labels
- `app-tauri/src/screens/database.js` — inline styles
- `app-tauri/src/screens/ingest.js` — inline style + error state
