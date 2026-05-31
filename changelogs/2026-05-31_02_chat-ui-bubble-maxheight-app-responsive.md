# Chat UI: contained scrollable bubbles + app-wide responsive defense tail

**Date:** 2026-05-31
**Type:** UI Enhancement

## Summary

Two issues from manual testing of the Chat tab: (1) a long assistant reply
rendered as one giant block that overflowed the panel and clipped its last
lines (no visible "box"), and (2) the whole app didn't reflow cleanly on window
resize. Fixed the chat to render each reply as a self-contained, capped-height
scroll box ("box inside the box"), shrank the chat text, made the chat panel
height viewport-relative, and appended a zero-specificity responsive defense
tail that retrofits the universal overflow guards app-wide.

## Changes

### Chat (Chat tab in topic.js)
- `.chat-msg-asst .chat-msg-body` — `max-height: min(460px, 52vh)` +
  `overflow-y: auto` + styled scrollbar so a long reply scrolls inside its own
  bubble instead of overflowing the panel and hiding text. More padding.
- `.chat-msg-body` font-size `13.5px → 13px`, line-height `1.6 → 1.5`.
- markdown headings shrunk (h1 17→15, h2 15→14, h3 14→13); added `ol`/`li`
  spacing.
- `.chat-messages` max-height `540px → min(540px, 56vh)` and `.chat-wrap`
  min-height `520px → min(520px, 70vh)` so the panel adapts to window height.
- `renderAssistantInPlace` now also pins the capped streaming bubble to the
  newest tokens (`bodyEl.scrollTop = bodyEl.scrollHeight`) so streaming still
  auto-follows inside the box.

### App-wide responsiveness (Phase 18 defense tail)
- Appended a zero-specificity `:where()` block at the end of `style.css` (wins
  by cascade order, never overrides intentional rules): flex-wrap on every
  user-content flex row, `min-width:0` on shrinkable flex children,
  `max-width:100%` on buttons/pills/inputs/media, `.table-wrap` overflow-x,
  modal `max-height: calc(100vh-32px)`, and a ≤680px tightening block.
  Complements the 40+ per-component breakpoints already present.

### Bare-1fr grid overflow guard
- 12 grids use a bare `1fr` track (`= minmax(auto,1fr)`) which blows out when a
  cell holds long unbreakable content. Added one `:where(...) > * { min-width: 0 }`
  rule covering them (tm-stat-row, pb-phase-list, science-process-grid,
  search-form, watch-form, src-pick-grid, empathy-grid, vw-form-grid, iv-row-2,
  estimate-rollup-grid, aud-quad-grid, gc-body) — same effect as `minmax(0,1fr)`
  without touching each declaration.

### Tab bar fix (regression from the defense tail)
- The defense tail's blanket `flex-wrap: wrap` initially included `.tabs`,
  which forced the topic tab bar to wrap to 3 rows. The app's intended design
  is a single horizontal-scrolling row (`.tabs` already has `overflow-x: auto`,
  `.tab { white-space: nowrap; flex-shrink: 0 }`). Removed `.tabs` from the
  wrap list AND added explicit `flex-wrap: nowrap` to the base `.tabs` rule so
  it's immune to the generic defense. Tab bar now scrolls horizontally.

## Files Modified

- `app-tauri/src/style.css`
- `app-tauri/src/screens/topic.js`

## Verification

- `node --check src/screens/topic.js` ✅
- `npm run build` → built in 1.98s, no CSS/JS errors.
- Live in the running dev app via HMR (6 `style.css` hot updates confirmed).
