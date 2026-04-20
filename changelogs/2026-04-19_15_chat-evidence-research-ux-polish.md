# Chat / Evidence / Research UX polish

**Date:** 2026-04-19
**Type:** UI Enhancement

## Summary

Eight targeted upgrades across three tabs of the topic page — making the chat interaction feel like a modern LLM product (auto-grow input, typing dots, per-message copy/regenerate, relative timestamps, markdown export), adding a long-missing search filter to Evidence, and giving Research a sort toggle + one-click copy-citation.

Functionality-wise nothing was broken; these are all first-class UX affordances users would expect from any modern build-guide tool.

## Changes

### Chat tab — 6 wins

**1. Compact preset pills.** Old rendering was 5 big two-line cards taking a full row. Now renders as horizontally-scrollable chips (`.chat-preset-pill` with icon + label). Same functionality; much less vertical real estate; better on narrow windows.

**2. Auto-grow textarea.** Input now grows with content (min 44px → max 180px, CSS-enforced + JS-driven). `Enter` = send (new), `Shift+Enter` = newline, `Cmd/Ctrl+Enter` still sends. Prior behavior required Cmd+Enter to send and ignored Enter entirely, which wasn't discoverable.

**3. Animated typing dots.** While the assistant is streaming with no tokens yet (model warmup), the bubble shows three bouncing dots instead of the old static "thinking…" word. Tool-call pending state uses the same dots.

**4. Copy + Regenerate per message.** Hovering an assistant bubble now surfaces two small actions (top-right corner):
- **Copy** → `navigator.clipboard.writeText(msg.text)`, flashes green "Copied" for 1.4s
- **Regenerate** (last assistant only, when not currently streaming) → finds the preceding user message and re-runs `send()` with it. Drops the stale reply first so `send` appends a fresh one.

**5. Relative timestamps.** Every message now stores a `ts` field (ms epoch) when created. The bubble renders it as `timeAgo()` — "just now" / "2m ago" / "3h ago". A `setInterval(30s)` refreshes all visible `.chat-msg-ts[data-ts]` elements while the Chat tab is active; cleared on tab-switch-away + hash cleanup to avoid leaks.

**6. Export conversation.** New **Export** button in the chat header. Downloads the full thread as `.md` with headers for each turn, ISO timestamps, tool-call collapsibles, and body content. Filename: `gapmap-chat-<topic-slug>-<timestamp>.md`. No network call, no server.

### Evidence tab — 1 win

**7. Search filter.** Rounded-pill search input at top. Narrows findings by `label` across all 4 kinds (painpoints / workarounds / products / feature wishes) in real time. 180 ms debounce (prevents re-render thrash on fast typing). Count pill shows "N of M findings" when filtered. Clean empty state when a filter matches zero. Focus + caret position preserved across re-renders.

### Research tab — 1 win

**8. Sort toggle + copy citation.** Two pill buttons at the top — **Most cited** (default, `score DESC`) / **Newest** (`created_utc DESC`). Client-side re-sort; no refetch. Each paper card gains a **Cite** button that copies a markdown-formatted citation to clipboard:

```
**Title** — Author(s) — _arXiv · 2024-01-15 · 42 cites_ — https://arxiv.org/abs/…
```

Flashes green "Copied" for 1.4s on success.

## CSS additions

Appended ~90 lines to `style.css`:
- `.chat-presets-pill` + `.chat-preset-pill` — horizontal scroll pill row
- `.chat-typing-dots` + `@keyframes chat-dot-bounce` — 3-dot bouncing animation
- `.chat-msg-actions` / `.chat-msg-action` / `.chat-msg-action.copied` — hover-reveal message actions
- `.chat-msg-ts` — relative timestamp styling
- `#chat-input` — min/max height + resize: none
- `.evidence-filter-row` + `.evidence-filter-count` — filter bar
- `.research-sort-row` + `.research-sort-btn` (+ `.active` state) — sort toggle
- `.paper-cite-btn` + `.paper-cite-btn.copied` — cite button

## Verification

```
$ node --check topic.js        # clean
$ npm run build                # 1732 modules transformed, 1.03 s
```

No regressions; build output size grew by ~60 KB in the uncompressed JS bundle (87 KB → 87 KB CSS, 1013 KB → 1041 KB JS, 15.88 KB → 17.22 KB CSS gzipped).

## Files Modified

- `app-tauri/src/screens/topic.js` — chat rendering overhaul, evidence filter, research sort/cite
- `app-tauri/src/style.css` — new UI primitives for all three tab polishes
