# Telegram + Slack Notifications (two-way control)

**Date:** 2026-06-29
**Type:** Feature

## Summary

Added a delivery layer that pushes OpenReply events to **Telegram** and **Slack**
while the app is running on the user's PC, configurable in Settings. Three
events fire alerts: a **new opportunity** worth replying to, a **newly drafted
post/article**, and a **reply due** reminder. Each alert carries the draft + a
link so the user can act fast. Telegram is **two-way**: opportunity and reply
alerts include inline buttons (Approve/Draft, Regenerate, Skip) that the desktop
app handles live via a frontend-driven poller — no always-on server or public
webhook required. Slack is notify-only (its buttons need a public endpoint a
local Mac can't host). All secrets (bot token, webhook URL) live in the local
SQLite app-data DB, never in URLs, and are masked in the UI to presence + last-4.

The three event sources already existed (opportunity discovery, autopilot
article generation, reply reminders) but only ever fired a native macOS
notification — this adds the actual Telegram/Slack transport plus per-event
dedup so the same opportunity/article/reply never re-alerts on every scheduler
tick.

## Changes

- **Transport + config** (`notify.py`): `reply_notify` singleton config row;
  `get_config` (secrets masked) / `set_config` (upsert); `is_configured`;
  `notify_once`/`was_notified`/`mark_notified` dedup keyed by
  `opp:`/`reply:`/`art:`; `send_telegram` (HTML, inline_keyboard via urllib),
  `send_slack` (incoming webhook); event formatters; `dispatch`; `send_test`.
- **Two-way poller** (`bot.py`): `poll(once=False)` reads token + two_way from
  config, long-polls `getUpdates` for `callback_query`, handles
  skip/posted/draft/regen actions, answers the callback, and edits the message.
  SIGTERM/SIGINT + `bot.stop` sentinel for clean shutdown.
- **Event hooks**: `opportunity.py` `_notify_new_opportunities` (gated by
  events.opportunity + min_score floor); `poster.py` reply-reminder branch fires
  `notify_once("reply:…")`; `scheduler.py` `_notify_article` on each generated
  autopilot article.
- **CLI** (`reply_cmds.py`): `notify-get`, `notify-set` (all flags incl.
  `--opp/--no-opp`, `--article/--no-article`, etc.), `notify-test`,
  `bot-poll [--once]`.
- **Rust bridge** (`commands.rs`, `main.rs`): `notify_get`, `notify_set`,
  `notify_test`, `bot_poll_once` commands registered.
- **Frontend** (`api.js`, `dynamic.js`, `main.js`): `notifyGet/notifySet/
  notifyTest/botPollOnce` wrappers; `buildNotifyCard` Settings card (Telegram
  token+chat, Slack webhook, event toggles, two-way toggle, min-score, Save +
  Send test); `ensureBotPoller` runs a 4s `bot-poll --once` interval while the
  window is open (self-gates on enabled + two_way + token; stops on unload).

## Files Created

- `src/openreply/reply/notify.py` — Telegram/Slack transport + config + dedup
- `src/openreply/reply/bot.py` — two-way Telegram callback poller

## Files Modified

- `src/openreply/reply/opportunity.py` — new-opportunity notify hook
- `src/openreply/reply/poster.py` — reply-due reminder notify hook
- `src/openreply/reply/scheduler.py` — article notify hook
- `src/openreply/cli/reply_cmds.py` — notify-get/set/test + bot-poll commands
- `app-tauri/src-tauri/src/commands.rs` — notify_get/set/test + bot_poll_once
- `app-tauri/src-tauri/src/main.rs` — register the 4 notify commands
- `app-tauri/src/or/api.js` — notify API wrappers
- `app-tauri/src/or/dynamic.js` — buildNotifyCard Settings card + ensureBotPoller
- `app-tauri/src/main.js` — start the bot poller on app boot
