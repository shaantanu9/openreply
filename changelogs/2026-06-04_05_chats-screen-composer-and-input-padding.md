# Chats screen: start-a-chat composer + fixed input padding

**Date:** 2026-06-04
**Type:** Feature + UI Enhancement

## Summary

The global **Chats** screen (`#/chats`) previously only *listed* saved
conversations — there was no way to start a chat from it, and its search input
was a bare `<input>` with no real padding/border (it inherited only
`width:100%`, which is why it looked cramped/misaligned in the screenshot).

This change (1) gives the search box proper padding/border/focus styling with a
leading magnifier icon, and (2) adds a **"Start a new chat"** composer at the
top of the screen: pick a topic, type a question, hit **Start chat** (or Enter)
→ it deep-links into that topic's **Chat** tab, opens a fresh thread, and
auto-sends the question. All the streaming/listener infrastructure stays in one
place (the topic Chat tab); the Chats screen just hands off via storage keys.

Topic selection is **single for now** (the chat engine grounds answers in one
topic's research — `start_chat` takes a single `topic`). The picker and handoff
are structured so multi-topic can be layered on later without reshaping the
screen.

## Changes

- **`chats.js`** — added a topic `<select>` + question input + "Start chat"
  button. `startNewChat()` writes `sessionStorage gapmap.topic.tab.<topic>='chat'`
  and `localStorage gapmap.chat.prefill.<topic>=<question>`, then navigates to
  `#/topic/<topic>`. Send button is disabled until both a topic and a non-empty
  question are present; Enter in the question field starts the chat. Topics load
  asynchronously (non-blocking for the saved-chat list); empty/error states are
  handled. Search input switched from inline `width:100%` to the new
  `.chats-input` class.
- **`topic.js`** — `loadChat()` now reads + clears
  `localStorage gapmap.chat.prefill.<topic>` up-front (so a queued question can
  never linger and fire on a later unrelated load), and consumes it after the
  composer is wired: starts a fresh conversation (`newConversation`) and
  auto-sends via `send('ask', q)`. Only fires when the composer actually
  rendered (topic has a corpus + a usable LLM).
- **`style.css`** — new `.chats-input` (padding 9×12, border, 10px radius,
  orange focus ring), `.chats-search-body` (icon + input row),
  `.chats-search-ic`, and `.chats-new*` composer styles with a responsive
  wrap at ≤720px.

## Files Created

- `changelogs/2026-06-04_05_chats-screen-composer-and-input-padding.md`

## Files Modified

- `app-tauri/src/screens/chats.js` — new-chat composer + topic picker + padded search input
- `app-tauri/src/screens/topic.js` — `loadChat()` reads/consumes the `gapmap.chat.prefill.<topic>` deep-link key to auto-start a chat
- `app-tauri/src/style.css` — `.chats-input` / `.chats-search-*` / `.chats-new*` styling
