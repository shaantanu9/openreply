# Watch X accounts — track creators, pull posts, repurpose

**Date:** 2026-06-28
**Type:** Feature

## Summary

You can now track specific X (Twitter) accounts — creators you admire or
competitors — and pull their recent posts into the agent's corpus + knowledge
base. From there you read them in Library, the brain learns from them, and you
repurpose/rewrite them in your own voice from Compose.

## How it works

- `reply/accounts.py` (new): `reply_accounts` table (per agent). `track_account`,
  `untrack_account`, `list_accounts`. `fetch_account` pulls a handle's posts via
  the existing X backend using the `from:<handle>` search operator
  (`sources.x_twitter.fetch_x`) — so it reuses your connected X login, no new
  scraper. Fetched posts are tagged into `posts` + `topic_posts`
  (`source = watch:x:@handle`), so they appear in Library, feed the knowledge
  blend (Compose/reply), and become memories on the next learn. `fetch_tracked`
  does all tracked accounts; optional `learn=True` runs a learn pass immediately.
- CLI: `agent watch-add <handle>`, `agent watch-list`, `agent watch-remove`,
  `agent watch-fetch [--handle H] [--learn]`. Handles accept `@naval`, `naval`,
  or `x.com/naval`.
- Tauri `account_track/list/untrack/fetch` + api.js `accountTrack/List/Untrack/Fetch`.
- New **Watch accounts** screen (sidebar): add a handle, fetch its posts, see
  samples, and "Repurpose in Compose →".

## Verification

- track / list / untrack persist (`reply_accounts`), handle normalization works
  for `@`, bare, and URL forms.
- `fetch_account` degrades gracefully when X isn't connected (clear message to
  connect X), tags posts into the corpus when it succeeds.
- `cargo check` clean.

## Files Created

- `src/openreply/reply/accounts.py`
- `changelogs/2026-06-28_09_watch-x-accounts.md`

## Files Modified

- `src/openreply/cli/agent_cmds.py`, `app-tauri/src-tauri/src/commands.rs`,
  `app-tauri/src-tauri/src/main.rs`, `app-tauri/src/or/api.js`,
  `app-tauri/src/or/dynamic.js`, `app-tauri/src/or/shell.js`

## Notes

- Requires **X connected** (Connections) to return live posts. The reliable X
  path is a connected `auth_token`+`ct0` (browser login / Cookie-Editor paste).
- The fetch uses `from:<handle>` search — it returns the account's own posts.
  Extending to full user-timeline (the vendored bird-search `UserTweets` query)
  is a future enhancement if `from:` coverage proves limited.
- The same pattern generalizes to other platforms (the `_PLATFORMS` map);
  X ships first.
