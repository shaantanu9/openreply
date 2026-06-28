# X: full user-timeline fetch for Watch accounts

**Date:** 2026-06-28
**Type:** Feature

## Summary

Watch-account fetching now pulls a handle's **actual timeline** via the
`UserTweets` GraphQL operation, instead of a shallow `from:<handle>` search —
deeper history, paginated — with a safe fallback so it never regresses.

## Changes

- **`sources/vendor/bird-search/bird-search.mjs`** — new `--user <handle>` mode:
  resolves the user's `rest_id` from a 1-result `from:` search, then pages the
  `UserTweets` op (mirrors the search client's request mechanism and reuses
  `parseTweetsFromInstructions` + `extractCursorFromInstructions` + the existing
  `UserTweets` query id + `buildUserTweetsFeatures`). On any failure it degrades
  to a deep `from:<handle>` search; never throws. The vendored `lib/` is
  untouched — only the entry script changed.
- **`sources/x_twitter.py`** — `fetch_x_user(handle, limit)`: runs bird
  `--user` (with a shared `_ensure_x_env()` credential resolver), and falls back
  to `fetch_x("from:<handle>")` when Node/bird aren't available.
- **`reply/accounts.py`** — the X branch of `fetch_account` now calls
  `fetch_x_user` for the full timeline.

No UI / Rust / CLI changes were needed — the Watch screen, `agent watch-fetch`,
and the Tauri `account_fetch` command all call `fetch_account`, which now pulls
the timeline.

## Verification

- `bird-search.mjs --user` parses & runs; returns a graceful `{error, items:[]}`
  without credentials.
- `fetch_x_user` / `fetch_account` degrade cleanly when X isn't connected.
- `tests/test_x_twitter.py` + `tests/test_x_twitter_creds.py`: 12 passed.

## Files Modified

- `src/gapmap/sources/vendor/bird-search/bird-search.mjs`
- `src/gapmap/sources/x_twitter.py`
- `src/gapmap/reply/accounts.py`

## Files Created

- `changelogs/2026-06-28_10_x-full-user-timeline.md`

## Notes

- Needs **X connected** (Connections — `auth_token` + `ct0`) to return live
  posts; without it the chain degrades to a clear "connect X" message.
- The `UserTweets` path goes through the same request mechanism the proven
  search path uses; if a given environment's endpoint doesn't support it, the
  `from:` fallback guarantees results — so this is strictly a superset of the
  previous behaviour.
