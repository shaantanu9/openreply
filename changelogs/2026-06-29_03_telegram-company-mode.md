# Telegram company-mode: multi-target, operator logging, channel-safe delivery

## Summary
Turns the single-user Telegram notification bot into a lightweight company reply engine. Multiple Telegram groups/channels can now receive OpenReply alerts, inline-button actions are attributed to the operator, and channels get button-free posts because Telegram does not deliver callback queries from channels.

## What changed

### Schema
- New `reply_telegram_targets` table stores multiple chat targets (`chat_id`, `type`, `label`, `enabled`, `added_at`).
- `reply_opportunities` gained `operator` and `operator_actioned_at` columns.
- `reply_drafts` gained an `operator` column.

### Notification delivery (`src/openreply/reply/notify.py`)
- `get_targets()` / `set_target()` manage multi-target configuration.
- Legacy single `telegram_chat` is lazily migrated into the targets table.
- `send_telegram()` broadcasts to every enabled target.
- Channel targets receive messages without inline keyboards.
- If a group send fails with a buttons-rights error, retry once without buttons.
- `operator` attribution is appended as a footer (`via @alice`) on action replies.

### Bot poller (`src/openreply/reply/bot.py`)
- Extracts operator identity from `callback_query.from` (`@username` or `id:<id>`).
- Passes operator through Skip / Posted / Draft / Regenerate actions.

### Lifecycle + drafts (`src/openreply/reply/opportunity.py`, `src/openreply/reply/generate.py`)
- `set_status`, `snooze`, `queue`, `approve`, `mark_posted`, `save_draft`, and `generate_reply` accept an optional `operator` and persist it.

### CLI (`src/openreply/cli/reply_cmds.py`)
- `openreply reply notify-set --telegram-chat "-123,-456"` accepts comma-separated chat ids (backward compatible).
- New `--telegram-target '{"chat_id":"...","type":"group","label":"Team"}'` (repeatable).
- New `--telegram-clear-targets`.

### Tests
- `tests/test_telegram_company_mode.py` covers migration, multi-target broadcast, channel-safe delivery, operator attribution, and bot handler wiring (11 tests, all passing).

## Setup example

```bash
# Backward-compatible single / comma-separated chat ids
openreply reply notify-set --telegram-token "<token>" --telegram-chat "-123456789"

# Explicit multi-target setup
openreply reply notify-set \
  --telegram-target '{"chat_id":"-123456789","type":"group","label":"Support"}' \
  --telegram-target '{"chat_id":"-1001234567890","type":"channel","label":"Alerts"}'

openreply reply notify-test
```

## Known limitations
- Channels are receive-only; buttons do not work in channels.
- No per-operator permissions yet — anyone in a group can tap any button.
- No forum-threading or message/mention command handler yet.

## Verification
```bash
.venv/bin/python -m pytest tests/test_telegram_company_mode.py tests/test_inbox_lifecycle.py -v
```
