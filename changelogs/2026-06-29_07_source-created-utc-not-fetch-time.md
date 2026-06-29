# Source items showed fetch time instead of real post/publish time

**Date:** 2026-06-29
**Type:** Fix

## Summary

Corpus / Brain / Daily-Update items from some sources displayed the time we
*fetched* them rather than when the post was actually published (e.g. a
YouTube video looked like it was "posted just now"). The display layer was
already correct — it reads `created_utc` as the real publish time and labels
it "posted" vs "found". The bug was in the ingestion layer: a few source
mappers stamped `created_utc` with the *fetch* time (`now` / `time.time()`)
whenever the real publish date was missing or unparseable, so those items
masqueraded as freshly posted.

Fix: those fallbacks now write `0.0` (unknown) instead of the fetch time. The
UI already hides the age chip (or labels it "found") when `created_utc` is 0,
so unknown-date items degrade gracefully and never present fetch-time as
post-time.

Note: this only affects newly collected rows. Items already in the DB keep
their stamped (wrong) `created_utc` until re-collected — re-running a
collection on the affected sources re-derives the correct dates.

## Changes

- `video.py:_parse_upload_date` (YouTube transcript/Whisper path) — return
  `0.0` instead of `datetime.now(...)` when yt-dlp gives no/invalid
  `upload_date`. This was the YouTube case in the report.
- `collect_adapter.py` Substack mapper — `created_utc` falls back to `0.0`
  instead of `time.time()` when the post date is missing/unparseable.
- `collect_adapter.py` Bluesky profile mapper — `created_utc` is `0.0`
  (profiles have no post date) instead of the fetch time.
- `collect_adapter.py` Product Hunt `today` mapper — `created_utc` is `0.0`
  (the `today` feed exposes no per-item post date) instead of the fetch time.
- Removed the now-unused `now_ts` locals in the Bluesky and Product Hunt
  collectors.

## Files Modified

- `src/openreply/sources/video.py` — `_parse_upload_date` no longer returns fetch time.
- `src/openreply/sources/collect_adapter.py` — Substack / Bluesky / Product Hunt mappers stamp `0.0` for unknown dates; dead `now_ts` removed.
