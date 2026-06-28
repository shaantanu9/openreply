# Chat sidebar (CHATS rail) UI polish + instant "New chat" draft row

**Date:** 2026-06-01
**Type:** UI Enhancement

## Summary

Reworked the topic Chat conversation rail so it looks finished and the **New** button gives immediate feedback. Previously: the rail was capped shorter than the chat panel (awkward empty space), conversation rows were single-line with a bare count, the empty state was plain text, and clicking **+ New** just blanked the panel — no new entry appeared until the first message was sent. Now the rail stretches to match the chat panel, rows are two-line (title + "N msgs · time"), the active chat is marked with a brand-orange accent, there's a friendly empty state, and **+ New** instantly shows an active "New chat" draft row that becomes the real saved thread once you send a message. Multiple chats per topic continue to work (each saved thread is a row; the draft becomes a new one on first send).

## Changes

- **Instant "New chat" feedback:** added a module-scope `pendingNewConv` Set. `newConversation()` adds the topic so the rail renders an active "New chat" draft row immediately. The flag is cleared the moment a message is sent (`send()`) — which mints + persists the real conversation — and when switching to an existing thread (`selectConversation()`).
- **`refreshConvRail()` rewrite:** renders the draft row pinned/active at the top when pending; each saved row now shows title + a subline (`N msgs · <relative time>` via `timeAgo(updated_at)`); click/dblclick/delete handlers scoped to real rows (`[data-conv]`) so the draft row is inert; nicer empty state with icon + guidance.
- **CSS (`style.css`):** rail uses `align-self: stretch` and drops the `max-height` cap so it matches the chat panel height (list scrolls internally); two-line `.chat-conv-body` (`.chat-conv-title` + `.chat-conv-sub`); active rows get a `border-left` brand-orange accent; draft row (`.is-draft`) styling; `.chat-conv-empty` styled empty state; header/`+ New` button de-shouted (not uppercase). Responsive ≤880px collapses the rail to a top strip.

## Files Modified

- `app-tauri/src/screens/topic.js` — `pendingNewConv` state; `newConversation`, `send`, `selectConversation` wiring; `refreshConvRail` rewrite (draft row, two-line rows, empty state).
- `app-tauri/src/style.css` — `.chat-conv-rail` + item/sub/empty/draft styling.

## Verification

- `node --check` passes on `topic.js`; CSS hot-reloaded live in the dev build (`npm run tauri:dev`). Pending visual confirmation in the dev window after a reload.
