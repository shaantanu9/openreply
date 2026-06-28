# Scheduled poster + reminder · Connections Test-all · Fetch correctness

**Date:** 2026-06-27
**Type:** Feature + Fix

## Summary

Three coordinated workstreams that complete the reply loop end-to-end: a
**scheduled poster + reminder** for queued replies, **Connections Test-all**,
and **fetch correctness** fixes so opportunities carry the right titles and the
fetch monitors the agent's tracked subreddit list.

## Changes

### Fetch correctness
- `sources/bluesky.py`: derive a readable `title` from post text (was empty →
  every Bluesky card showed "(no title)").
- `reply/opportunity.py`: `_fetch_reddit` now also monitors the agent's **tracked
  subreddits** (`reply/subreddit.list_tracked`) via sub-scoped `fetch_reddit_free`,
  deduped with the keyword passes — discovery knows the community list, not just
  keyword search. New `_tracked_subs()` helper.
- `or/dynamic.js`: `subLabel()` renders `r/x` only for Reddit; social platforms
  (whose adapters hardcode `sub` = platform name) no longer show a bogus "r/x".

### Connections
- `or/dynamic.js renderConnections`: **Test all** button runs the genuine
  per-source `creds_verify` (live fetch) for every reachable source, updating each
  card's status inline with a running counter and a summary toast. (last-verified
  time, "unlocks" chips, connected/error states were already present.)

### Scheduled poster + reminder
- `reply/poster.py` (new): `process_due()` + `due_opportunities()` — finds queued
  replies whose `scheduled_at` is due; best-effort `_autopost` (Reddit write hook,
  no-op while the client is read-only) else collects a reminder; `_notify()` fires
  a native macOS notification when run headless.
- `cli/reply_cmds.py`: `reply post-due [--notify]`.
- `cli/main.py`: poster wired into `research schedule-tick` so every launchd cycle
  processes due replies + reminds (`replies_due` in the tick result).
- `commands.rs` + `main.rs`: `reply_post_due` (registered). `or/api.js`:
  `replyPostDue()`.
- `or/dynamic.js renderInbox`: "Due now" badge on queued replies past their
  schedule; processes due items on open (auto-posts where possible, refreshes if
  any posted).

## Files Created

- `src/openreply/reply/poster.py`
- `docs/superpowers/specs/2026-06-27-queue-poster-connections-fetch-design.md`
- `changelogs/2026-06-27_18_poster-connections-fetch.md`

## Files Modified

- `src/openreply/sources/bluesky.py`, `src/openreply/reply/opportunity.py`,
  `src/openreply/cli/reply_cmds.py`, `src/openreply/cli/main.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/or/api.js`, `app-tauri/src/or/dynamic.js`

## Verification

- Python (`.venv`): bluesky title derivation, tracked-sub wiring, `process_due`
  end-to-end (1 due → 1 reminder with honest "no write credentials" reason) — pass.
- Rust: `cargo check` 0 errors. Frontend: `vite build` clean.

## Known gaps

- Auto-posting is a hook only: Reddit/social *write* APIs aren't wired (clients are
  read-only). When a write-enabled Reddit account (OAuth refresh token) is connected,
  `_autopost`'s Reddit branch is where `submission.reply` goes. Until then, due
  replies surface as reminders ("Due now" + macOS notification) for manual posting.
- Reminder notifications are macOS-only (matches the launchd-based scheduler).
