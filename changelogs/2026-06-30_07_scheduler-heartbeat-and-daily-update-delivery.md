# Scheduler heartbeat command + daily-update delivery to Telegram/Slack

**Date:** 2026-06-30
**Type:** Fix

## Summary

The OS scheduler (launchd) was firing a command that did not exist
(`openreply research schedule-tick`), so **nothing ran automatically** — no
opportunity alerts, no auto-pilot content, no reply reminders, and no daily
update. Separately, even when the auto-pilot did run (manually), the Daily
Update digest was never pushed to Telegram/Slack: a `digest` formatter and an
`ev_digest` toggle existed but nothing ever called `notify.dispatch("digest", …)`.

This adds a real top-level `schedule-tick` command that orchestrates the full
hands-free heartbeat, wires the daily update into it as an opt-in
Telegram/Slack push, and fixes the launchd plist to invoke the real command.

## Root causes fixed

1. **Phantom scheduled command.** `app-tauri/src-tauri/src/schedule.rs` installed
   a launchd plist whose `ProgramArguments` were `[sidecar, "research",
   "schedule-tick", "--json"]`. There is no `research` command group, so every
   tick errored `No such command 'research'` and did nothing.
2. **Daily update never delivered.** `reply/digest.build_digest()` was only
   called by the UI command. The scheduler never built or sent it, and
   `ev_digest` defaults off, so the digest never reached Telegram/Slack.

## Changes

- Added a top-level `openreply schedule-tick` command (the launchd entry point).
- Added `run_scheduled_tick()` orchestrating the full heartbeat: auto-pilot
  (content + opportunity discovery/drafting → existing opportunity/draft alerts),
  due reply reminders, AI-visibility (geo) checks, and the daily update push.
  Each leg is independently guarded; the command always exits 0 with a JSON
  payload the Rust wrapper can parse.
- Added `send_daily_update_if_enabled()` — builds today's digest (cached one
  row/agent/day) and pushes a briefing + top source links via
  `notify.notify_once("digest:<agent>:<day>", …)`. Gated on notifications being
  configured **and** the opt-in `digest` event toggle; deduped so it sends once
  per day no matter how many ticks fire. Falls back to top feed links when no
  LLM is configured.
- Added `_format_digest_md()` — renders the digest into Telegram-safe markdown
  (`**theme**`, `[title](url)`) consumed by the existing `digest` formatter.
- `process_due_content()` in the auto-pilot path now runs with `notify=True` so
  a scheduled post that can't auto-publish surfaces a Telegram reminder.
- Fixed the launchd plist `ProgramArguments` to `[sidecar, "schedule-tick",
  "--json"]` and updated the module doc comment. Re-toggling the scheduler
  rewrites + reloads the plist, so existing installs self-heal on next toggle.

## How to turn it on (operator notes)

1. **Notifications** → add Telegram bot token + chat id (or Slack webhook),
   tick **Notifications on**, and tick **Daily digest** to receive the daily
   update (it is opt-in / off by default). Opportunity, drafted-post, and
   reply-due alerts are on by default.
2. **Auto-pilot** toggle installs the scheduler (`scheduleInstall`, default
   every 24h; interval is configurable from settings). Opportunities and the
   daily update then flow automatically on each tick.

## Files Created

- `changelogs/2026-06-30_07_scheduler-heartbeat-and-daily-update-delivery.md`

## Files Modified

- `src/openreply/reply/scheduler.py` — added `run_scheduled_tick()`,
  `send_daily_update_if_enabled()`, `_format_digest_md()`; `process_due_content`
  now notifies.
- `src/openreply/cli/main.py` — registered the top-level `schedule-tick` command.
- `app-tauri/src-tauri/src/schedule.rs` — plist now calls `schedule-tick`
  (removed the non-existent `research` group); doc comment updated.
