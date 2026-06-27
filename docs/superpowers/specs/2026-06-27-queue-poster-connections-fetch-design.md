# OpenReply — Scheduled poster + Connections polish + Fetch correctness

**Date:** 2026-06-27
**Status:** Approved — implementing
**Decisions:** Poster = reminder-first + best-effort auto · Connections = polish + Test-all ·
Fetch = fix titles + scan tracked subreddits

## C. Fetch correctness (build first)

- **Bluesky title** (`sources/bluesky.py`): empty `title` → derive from the post text
  (first ~120 chars) or `Bluesky post by @{handle}`.
- **`r/{sub}` display** (`or/dynamic.js`): render the `r/` prefix only when the platform
  is Reddit. For other platforms show the community/handle plainly, and omit when `sub`
  equals the platform name (the adapter's placeholder). UI-side only — avoids fighting
  concurrent edits to the adapters.
- **Scan tracked subreddits** (`reply/opportunity.py` `_fetch_reddit`): in addition to
  keyword search, pull recent posts from the agent's tracked subreddits
  (`reply/subreddit.py list_tracked`) via `fetch_reddit_free` scoped to each sub. Dedup by
  id with the keyword passes. So the fetch "knows the list" it should monitor.

## B. Connections polish

- `creds_list` (python) surfaces `last_verified_at` + `unlocks` per source (from
  `reach_connections`). `renderConnections` (`or/dynamic.js`): a **Test all** button that
  runs the real `creds_verify` per source sequentially with live per-card status; clear
  connected ✓ / error ✗ state + message; **last-verified** relative time; **"unlocks: …"**.

## A. Scheduled poster + reminder

- **`reply/poster.py`** (new): `process_due(now=None)` → queued opps with `scheduled_at ≤ now`;
  per opp get `current_draft` text; `_autopost(opp, text)` best-effort (Reddit via PRAW only
  if a write-capable client exists — read-only today, so it no-ops and falls through to
  reminder); else collect as "due". Returns `{posted, due, errors}`. `due_opportunities()`
  helper lists currently-due queued items (for the UI badge + count).
- **Reminder transport:** the CLI fires a native macOS notification
  (`osascript -e 'display notification'`) when run headless (launchd) and items are due.
  When the app is open, the Inbox Ready tab shows a **"Due now"** badge (computed from
  `scheduled_at ≤ now`) and a "Post due (N)" nudge.
- **CLI** `gapmap reply post-due [--notify] [--json]` → `process_due` + notification.
- **Scheduler:** call `reply post-due` from the existing `schedule-tick` loop
  (`cli/main.py`) so every tick processes due replies.
- **Tauri** `reply_post_due` + `api.replyPostDue()`; the Inbox calls it on open to fire
  best-effort auto-posts and get the due list.

## Testing

Python: `.venv` unit checks for `process_due` (due selection, no-op autopost → due),
bluesky title, tracked-sub scan dedup, `creds_list` fields. Rust `cargo check` 0 errors.
Frontend `vite build` clean. Manual: queue a reply with a past schedule → `reply post-due`
reports it due + notifies; Inbox shows "Due now"; Connections Test-all shows live states.

## Build order / commits

C (fetch) → B (connections) → A (poster) → docs. One commit per workstream.
Re-read each file immediately before editing (concurrent session active).
