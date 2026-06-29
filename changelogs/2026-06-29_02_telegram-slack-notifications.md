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

## Hardening (lessons adapted from the `openclaw` bot framework)

Reviewed openclaw's (TypeScript/grammY + `@slack/bolt`) Telegram/Slack stack and
adopted the parts that fit OpenReply's deliberately minimal, stdlib-only,
frontend-poll design (skipped the heavy bits: grammY/Bolt SDKs, webhook/Socket
modes, multi-account, pinned-IP network fallback — all need always-on/public
infra OpenReply intentionally avoids):

- **getUpdates offset persistence (real bug fix).** The `--once` poller runs as a
  fresh process every ~4s; Telegram only drops an update once a *later* getUpdates
  carries `offset = update_id + 1`. Without persisting that watermark, each pass
  re-fetched the same `callback_query` and **the same button tap fired every
  tick**. Now persisted to `bot.offset` in the data dir and resumed each pass
  (`bot.py` `_offset_path`/`_load_offset`/`_save_offset`, saved before acting =
  crash-safe). This is the single tiny-file version of openclaw's watermark
  tracking.
- **HTML→plain-text fallback.** If Telegram rejects a message with a parse-entity
  error, `send_telegram` retries once as plain text (tags stripped) instead of
  dropping it — a notification with imperfect formatting beats none.
- **Length cap.** Body capped to Telegram's 4096 ceiling (`_TG_LIMIT = 4000`).
- **Single send path.** `bot._send` now delegates to `notify.send_telegram`, so the
  cap + fallback live in one place.
- **Frontend re-entrancy guard.** `ensureBotPoller` skips a beat if the previous
  `--once` pass is still in flight, so a slow pass can't overlap and double-process.

Validated openclaw's design choice that **Slack interactive buttons require a
public endpoint / Socket Mode** — confirms keeping Slack notify-only here.

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
