# X fetch now returns latest posts instead of stale/old tweets

**Date:** 2026-06-29
**Type:** Bug Fix

## Summary

Fetching posts for an X account was returning old tweets (e.g., 2024) instead of
latest ones (2026). The vendored bird client now merges `UserTweets` with a
`from:<handle>` search and returns the newest results first.

## Root cause

With placeholder/public X credentials, the `UserTweets` GraphQL endpoint was
returning stale or old popular tweets. The existing `from:<handle>` search
fallback returned the latest timeline, but it was only used when `UserTweets`
failed completely — not when it returned misleadingly old data.

## Changes

- **`sources/vendor/bird-search/bird-search.mjs`** (`fetchUserTimeline`):
  - Always fetch `from:<handle>` search (reliable latest posts with any
    credentials).
  - Also page `UserTweets` for extra coverage / deeper history.
  - Merge both sources, dedupe by tweet id, sort by `createdAt` descending, and
    return the top `count` newest tweets.
  - Added `tweetTime()` helper for stable date sorting.

## Verification

- `node --check src/openreply/sources/vendor/bird-search/bird-search.mjs` clean.
- Direct test with placeholder cookies: `node bird-search.mjs --user elonmusk
  --count 5 --json` now returns 2026-06-29 posts instead of 2022/2024 posts.
- Python path verified: `fetch_x_user('elonmusk', 5)` returns timestamps for
  today's posts.

## Files Modified

- `src/openreply/sources/vendor/bird-search/bird-search.mjs`

## Files Created

- `changelogs/2026-06-29_02_x-fetch-latest-posts.md`
