# Global "Chats" view — every saved conversation across all topics

**Date:** 2026-05-31
**Type:** Feature

## Summary

Completes the ChatGPT-style chat history (companion to changelog 10). Adds a
top-level **Chats** screen at `#/chats` that lists every saved topic-AI
conversation across all topics in one searchable list. Clicking a conversation
deep-links straight into its topic's Chat tab with that exact thread opened.

No new storage — this reuses the `chat_conversations` table and the existing
`chat_conv_list` native command, which already accepts `topic = NULL` to return
every conversation newest-first.

## Changes

- **New screen** `app-tauri/src/screens/chats.js` (`renderChats`): loads
  `api.chatConvList(null)`, renders a list (title · topic · message count ·
  relative time), with a client-side search box over title + topic. Empty/error
  states handled; routeGen-guarded like the other screens.
- **Deep-link handoff**: clicking a conversation sets
  `sessionStorage openreply.topic.tab.<topic> = 'chat'` (land on the Chat tab),
  `localStorage openreply.chat.active.<topic> = <id>` (remember the thread), and
  `localStorage openreply.chat.open.<topic> = <id>` (force-open), then navigates to
  `#/topic/<topic>`.
- **topic.js `hydrateChat`**: honours the `openreply.chat.open.<topic>` force-open
  key *before* the per-session hydration guard, so the exact thread opens even
  if that topic's chat was already hydrated this session.
- **Route + nav**: `{ match: /^\/chats\/?$/, render: renderChats }` in
  `main.js` (+ import); a "Chats" link (messages-square icon) in the Workspace
  section of `index.html`.
- **style.css**: `.chats-global-list` / `.chats-global-item` (+ icon, title,
  sub, time) styles.

## Verification

- `node --check` clean on chats.js / main.js / topic.js.
- `npm test` → 50/50 pass.
- `npm run build` → ✓ 1778 modules transformed, `chats.js` bundled, no errors
  (only pre-existing dynamic/static import warnings).
- Not yet click-tested in a live `tauri:dev` window; recommend smoke-testing the
  deep-link (open a chat from `#/chats` → lands on the right topic's Chat tab
  with the thread loaded).

## Files Created

- `app-tauri/src/screens/chats.js`
- `changelogs/2026-05-31_11_global-chats-view-all-topics.md`

## Files Modified

- `app-tauri/src/main.js` — import + `/chats` route.
- `app-tauri/index.html` — Chats sidebar nav link.
- `app-tauri/src/screens/topic.js` — `hydrateChat` force-open deep-link.
- `app-tauri/src/style.css` — global Chats list styles.
