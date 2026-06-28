# Idiomatic JS pass — async-gap guards + color tokenization (tab & sidebar screens)

**Date:** 2026-05-30
**Type:** Fix + Refactor

## Summary

Applied the Flutter "idiomatic" rubric (translated to this vanilla-JS/Tauri
codebase) to the tab sections and sidebar-menu screens, scoped to **Tier 1:
correctness + design tokens** (no primitive/pageShell adoption, no god-file
decomposition). Two fix-types were swept across the affected screens:

1. **Async-gap guards** — the JS analog of Flutter's `context.mounted`. After
   an `await`, a screen can have been navigated away (the router bumps
   `#main-content`'s `dataset.routeGen` on every route, including tab switches
   via `history.replaceState`). Writing to the DOM after such an `await`
   produces a stale render — the result paints into whatever screen is now
   showing, or a slow query mutates a detached node. Added the canonical
   `const myGen = root.dataset.routeGen; const alive = () => root.dataset.routeGen === myGen && root.isConnected;`
   guard (matching the existing `settings.js`/`science.js` pattern) and an
   `if (!alive()) return;` after each post-`await` DOM write and in catch
   blocks that write DOM.

2. **Color tokenization** — moved the worst hardcoded-hex clusters out of inline
   `style="…"` attributes into CSS classes/selectors in `style.css`. Exact hex
   preserved → **no visual change**; the palette now has a single source of
   truth (the `Theme.of`/design-token analog).

## Changes

### Async-gap guards (correctness — P0/P1 stale-render bugs)
- **database.js** — `runQuery`, `renderTableList`, `browseTable`: a slow
  `api.runQuery` could resolve after navigation and write to a detached node.
  Guarded all post-`await` writes + catch blocks. (P0)
- **activity.js** — the 4s live-poll `setInterval` cleaned up only on
  `hashchange`, which misses `history.replaceState` tab switches → kept
  polling and mutating dead DOM. Interval now self-clears via `alive()`;
  `loadSpark`/`loadPage`/`checkLive` guard their post-`await` writes. (P0)
- **improve.js** — `refreshAndPaint`, `runPipeline` (multi-minute pipeline run),
  `renderPicker` (`$(...).innerHTML` with no `?.` → null-deref risk). Guarded.
- **launch.js** — `generateAndRender`, `renderTopicLaunch`, `renderPicker`.
- **empathy.js** — `renderTopicEmpathy`, the `#empathy-build` handler,
  `renderPicker`.
- **prd.js** — `renderPrd`/`build` closure + the `#prd-copy` clipboard handler.
- **insights.js** — `loadCompetitorMatrix`. (Uses the sub-tab
  `dataset.tab === 'insights'` signal, since this loader runs on `#tab-content`,
  which does not carry `routeGen`.)
- **Verified already-safe (no change):** `concepts.js`, `solutions.js` (sub-tab
  `dataset.tab` guards), `personas.js` (routeGen guard + `stop()`), `tasks.js`
  (MutationObserver teardown), `collects.js` (`stillHere`), `home.js`
  (`document.body.contains(slot)` / `alive`), `topic.js` (re-query + `if(el)`).

### Color tokenization (no visual change — exact hex preserved)
- **collects.js** — `statusBadge()` inline-hex map (10 hex) → `.cm-badge--running
  /queued/done/failed/cancelled/idle` classes in `style.css`.
- **insights.js** — `renderSourceBadges()` inline `SRC{}` palette (12 hex) →
  `.insight-src-badge[data-source="…"]` selectors (the badge already carried
  the `data-source` attribute).
- **improve.js** — `checkmark()` + `stageRow()` tone (3 semantic hex) →
  `.imp-mark`, `.imp-stat--ok/warn/bad`, `.imp-tone--ok/warn/bad` classes.
- **activity.js** — error pill one-off `#B84747` → `.pill-error` class.

## Files Modified

- `app-tauri/src/screens/database.js` — async-gap guards (3 functions)
- `app-tauri/src/screens/activity.js` — self-clearing interval + guards + `.pill-error`
- `app-tauri/src/screens/improve.js` — async-gap guards + `.imp-*` color classes
- `app-tauri/src/screens/launch.js` — async-gap guards (3 functions)
- `app-tauri/src/screens/empathy.js` — async-gap guards (3 sites)
- `app-tauri/src/screens/prd.js` — async-gap guards (2 sites)
- `app-tauri/src/screens/insights.js` — `loadCompetitorMatrix` guard + `.insight-src-badge[data-source]`
- `app-tauri/src/screens/collects.js` — `statusBadge` → `.cm-badge--*` classes
- `app-tauri/src/style.css` — added `.cm-badge--*`, `.insight-src-badge[data-source]`, `.pill-error`, `.imp-*` (all color-only, no padding/margin px added)

## Verification

- `node --check` passes on all 8 modified JS files.
- `npm test` — 40/40 pass.
- No inline hex remains in the migrated functions.

## Notes / pre-existing state (not part of this change)

- The working tree was already dirty at session start with an in-flight
  "analyzing-loader rollout" (concepts/empathy/improve/insights/launch/prd/
  solutions + style.css) and MCP-settings work. Those changes were **not**
  authored here and are intentionally left untouched.
- `scripts/check_css_consistency.sh` reports 1160 vs ceiling 1142 — but `HEAD`
  itself is already at **1154** (above the ceiling), so the ratchet was stale
  before this session. This pass added **0** padding/margin px; the extra px
  come from the pre-existing loader-card styles. The ceiling needs a separate
  reconcile.
