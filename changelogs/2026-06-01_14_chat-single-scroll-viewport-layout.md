# Fix: proper chat page layout — single scroll region, no double/nested scroll

**Date:** 2026-06-01
**Type:** Fix | UI Enhancement

## Summary

The Chat tab had two stacked scrollbars: each assistant reply was its own
scrollable box (`max-height` + `overflow-y:auto` on `.chat-msg-asst
.chat-msg-body`), AND the whole panel was taller than the viewport
(`.chat-wrap { min-height: min(520px,70vh) }` + `.chat-messages { max-height:
min(540px,56vh) }`), so the page scrolled too. Result: a "box-in-a-box" feel
where the answer scrolled, the message list scrolled, and the page scrolled —
confusing and not how a chat should behave.

Reworked it into the standard chat layout: the panel is fitted to the viewport
(exactly the space below the topbar/tab-strip), the header and composer are
pinned, and **the message list is the only scroll region**.

## Changes

- **`style.css`**
  - `.chat-layout` — `height: var(--chat-h, calc(100dvh - 150px))` so the panel
    fills the viewport and the page doesn't scroll; flex with `align-items:
    stretch`. `.no-rail` now `display:flex` too.
  - `.chat-main-col` — `display:flex; flex-direction:column; min-height:0` so
    the wrap fills the column height.
  - `.chat-wrap` — replaced `min-height: min(520px,70vh)` with `flex:1;
    min-height:0` (fills the fitted layout height).
  - `.chat-messages` — removed `max-height: min(540px,56vh)`; now `flex:1 1 auto;
    min-height:0; overflow-y:auto` → the single scroll region.
  - `.chat-msg-asst .chat-msg-body` — removed the per-reply `max-height` +
    `overflow-y:auto` + scrollbar styling (the "answer has its own scrollbar"
    bug). Replies now flow at full height inside the one scroll region.
  - Pinned (`flex-shrink:0`): `.chat-head`, `.chat-presets-pill`,
    `.chat-status`, `#chat-no-findings-hint`, `.chat-input-row`.
  - `.chat-conv-rail` — `min-height:0` (was 420px) so it fits the fitted height
    and its list (`.chat-conv-list`) remains the rail's only scroll.
- **`topic.js`** — `loadChat` now sets `--chat-h` precisely from the layout's
  `getBoundingClientRect().top` to the viewport bottom (exact regardless of how
  the topbar/tabs wrapped), re-measures on `window.resize` and on the next
  animation frame, and self-removes the resize listener on tab switch /
  navigation (no leak; replaces any prior listener).

## Files Modified

- `app-tauri/src/style.css` — chat layout rules (single scroll, pinned chrome).
- `app-tauri/src/screens/topic.js` — `loadChat` viewport-fit height logic.

## Relationship to other changelogs

- Follows the chat-composer wiring hardening + global JS error overlay
  (committed in `916a684`) which restored Send/Enter; this entry is the layout
  pass on top of a working composer.
