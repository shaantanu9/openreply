# X Account: always fetch the latest posts (newest-first), fix recurring "older tweets" regression

**Date:** 2026-06-30
**Type:** Fix

## Summary

`fetch_posts()` in the X-account module returned tweets in whatever order the
source handed them back, with no newest-first ordering and no cap to `count`.
Both the bird path and the GraphQL `UserTweets` path can lead with old content
(the GraphQL timeline commonly puts a **pinned** tweet — often years old —
first), so the UI kept surfacing older tweets instead of the latest. A prior
fix had relied on sorting by the `created_at` string, but Twitter's
`created_at` is in `"Wed Oct 10 20:19:24 +0000 2018"` format, which does **not**
sort chronologically as a string — so the bug kept coming back.

The fix sorts by the numeric **snowflake tweet id** (monotonically increasing
with creation time) descending and truncates to `count`. This is
format-agnostic and source-agnostic, so "fetch the latest N posts" now always
holds regardless of date-string format or a pinned tweet.

## Changes

- Added `_order_latest(results, count)` helper: sorts by `int(id)` descending
  (null-id safe) and caps to `count`.
- Applied it to **both** return paths in `fetch_posts()` (bird early-return and
  GraphQL fallback). `save_posts_to_corpus()` benefits automatically since it
  calls `fetch_posts()`.
- Left `fetch_thread()`'s chronological (oldest-first) sort alone — threads are
  meant to read top-to-bottom.

## Verification

- Unit check: a mix including a pinned 2018 tweet ordered to `['900','800','500']`
  (newest-first, capped to 3), null-id input did not crash.
- Live fetch of `@elonmusk` (count=5): ids returned strictly descending
  (newest-first confirmed). (Sample shows older dates only because the stored
  account uses placeholder cookies → public-sample fallback; ordering is correct.)
- `pytest tests/test_social_growth_sources.py` — 6 passed.

## Files Modified

- `src/openreply/x_account/fetch.py` — added `_order_latest`; both `fetch_posts`
  return paths now return newest-first, capped to `count`; updated docstrings.
