# Telegram bot: free-text chat, command menu, quick-action buttons

**Date:** 2026-06-30
**Type:** Feature

## Summary

The Telegram bot previously only reacted to inline button taps and the single
`/draft` command — any other message was silently ignored, and there was no
help, command menu, or way to chat. This turns the bot into a full two-way
assistant: plain messages are answered as a grounded agent chat (with the same
knowledge + citations as the in-app chat), a slash-command menu is registered
with Telegram so it autocompletes under `/`, and an inline button panel makes
the common actions one tap. It also fixes a latent duplicate-processing bug
that would otherwise double-fire (and double-bill) the new LLM chat replies.

## Changes

- **Free-text chat.** A message without a leading `/` is routed to
  `reply.chat.chat_with_agent`, grounded in the active agent's knowledge,
  corpus, and graph. History is persisted as a `telegram:<chat>` conversation
  so the thread also appears in the app's chat list (reuses
  `get_chat_conversation` / `save_chat_conversation`). A "typing…" indicator
  shows while the LLM answers; the markdown answer is rendered to Telegram HTML.
- **Command menu** (registered via `setMyCommands`, once per data dir):
  - `/help` & `/start` — what the bot does + the quick-action button panel
  - `/menu` — quick-action buttons
  - `/today` — build (cached per day) + send today's Daily Update on demand
  - `/find` — top new opportunities, each with Draft / Skip buttons
  - `/draft <platform> <angle>` — generate a post (existing, now in the menu)
  - `/reset` — clear this chat's conversation history
  - `@botname` suffixes (group mentions like `/find@MyBot`) are stripped.
- **Inline button panel** (`menu:*` callbacks) for Daily update / Opportunities
  / Draft / Help, handled alongside the existing action buttons.
- **Update-offset persistence + at-most-once handling.** The Tauri app drives
  the poller as `bot-poll --once` every 4s, each a fresh process that previously
  restarted at `offset=None` and re-handled pending updates every tick. The next
  offset is now persisted to `bot.offset` and acked *before* the handler runs,
  so two overlapping 4s passes can't process the same update twice — essential
  now that a handler (chat) can take 10–20s, and a fix for the prior
  button-duplicate behavior.

## Files Created

- `changelogs/2026-06-30_08_telegram-bot-chat-commands-and-menu.md`

## Files Modified

- `src/openreply/reply/bot.py` — offset persistence (`_load_offset` /
  `_save_offset`), `setMyCommands` registration, help/menu/typing helpers,
  `_chat_reply` / `_reset_chat`, `_send_daily_update` / `_send_opportunities`,
  `_handle_menu` / `_handle_command_message`, and `poll()` rewired to ack-first
  and route commands + free-text chat. Module docstring updated.
