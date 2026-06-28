# Graceful "no AI provider" errors in chat (and map chat)

**Date:** 2026-06-04
**Type:** UX Fix

## Summary

When no LLM/AI provider was connected (or the provider errored), the chat dumped
raw text into the assistant bubble — `✗ Error: <raw>`, `✗ Provider exited with
code N`, `✗ Failed to start chat: <stack>`. This replaces all of those with a
friendly, actionable message that points the user at the **LLM pill** in the chat
panel, plus a pre-send guard that catches the no-provider case before firing a
doomed request.

## Changes

- **Map-view chat** (`topic.js::_mapChatSend` / `_mapChatBotHtml`): on a missing
  provider or error, render a graceful error **card** (alert icon + friendly
  title + hint) with a **Connect AI** button (opens the provider picker) for the
  no-LLM case, or **Retry** for transient errors. Pre-send `hasLlmConfigured()`
  guard shows the card immediately instead of sending. Errors are classified via
  `lib/tabEmpty.js::classifyError`.
- **Chat tab** (`topic.js::send` / `handleChatLine` / `onChatDone` / catch): new
  `friendlyChatError()` helper maps the error class → a clear markdown message
  ("**No AI provider connected.** Click the **LLM** pill…"); pre-send guard shows
  it instead of firing. Covers token-stream errors, non-zero provider exit
  (honours `error_class: 'llm_key'`), and start failures.
- **Graph enrich** start-failure status line: friendlier copy (no raw stack).
- `style.css`: `.mapchat-err` card styling (warm/amber, icon, action row).

## Verification

- `node --check` clean · `npm test` 50/50 · `npm run build` OK.
- Confirmed no raw `✗ Error` / `Provider exited` / `Failed to start` dumps remain.

Tabs/pipelines already used the graceful `renderError` (Settings link) path, so
this brings chat in line with the rest of the app.

## Files Modified
- `app-tauri/src/screens/topic.js`
- `app-tauri/src/style.css`
