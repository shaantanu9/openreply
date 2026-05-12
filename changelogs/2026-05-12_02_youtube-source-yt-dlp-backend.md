# YouTube source: yt-dlp backend (free, no API key, no quota)

**Date:** 2026-05-12
**Type:** Feature

## Summary

The `youtube` collect source previously required a `YOUTUBE_API_KEY` and was
gated out of the aggressive default sweep. Swapped the backend to `yt-dlp`
(scrapes the public web frontend — no key, no daily 10k-unit quota) while
keeping the output row shape identical so `collect_adapter.run_youtube()`,
`_persist()`, and every downstream consumer (insights, empathy, intent
ladder, palace retrieval, etc.) work unchanged.

The YouTube Data API v3 path is preserved as a fallback that activates only
if `yt_dlp` cannot be imported AND `YOUTUBE_API_KEY` is set. yt-dlp comes
pinned-then-auto-updated through the existing `transcribe.ytdlp_client`
overlay (same machinery the video transcription source uses), so the
extractor stays current as YouTube rotates its frontend.

Smoke test against the user's reference video `02q1jqTCWEg` (Banjaare -
Bairan, 68 comments) and a fresh `lofi study` keyword search: search
returned 3 videos, fetch returned 5 comments per video including threaded
replies (dotted IDs), rows landed in `posts` with `source_type='youtube'`
and were tagged in `topic_posts` under `source='youtube:<vid>'`.

## Changes

- Rewrote `youtube.py` with a yt-dlp-first backend and a Data-API-v3
  fallback. Public surface (`search_youtube_videos`, `fetch_youtube_comments`)
  and `_comment_row` shape unchanged.
- Lazy-import `yt_dlp` and call `transcribe.ytdlp_client._inject_overlay_to_path`
  first so we pick up the auto-updated extractor.
- Added `youtube` to the aggressive default source list in
  `research/collect.py` (it's now free, so no reason to keep it opt-in).
- Updated the inline opt-in comment to drop the `YOUTUBE_API_KEY` line.
- Updated `run_youtube` docstring in `collect_adapter.py` to document the
  new backend + fallback.
- Synced the frontend `AGGRESSIVE_SOURCES` mirror in `collect.js` (was
  missing `trustpilot`, `rss_products`, `rss_tech_news`; added `youtube`).
- Added pretty labels for `rss_products` / `rss_tech_news` in the chip
  `SOURCE_LABELS` map (they were previously falling back to raw IDs).

## Files Created

- `changelogs/2026-05-12_02_youtube-source-yt-dlp-backend.md`

## Files Modified

- `src/reddit_research/sources/youtube.py` — yt-dlp backend (search +
  comments) with graceful Data-API-v3 fallback. Same row shape as before.
- `src/reddit_research/sources/collect_adapter.py` — updated `run_youtube`
  docstring.
- `src/reddit_research/research/collect.py` — added `youtube` to the
  aggressive default sources list, dropped the `YOUTUBE_API_KEY` opt-in note.
- `app-tauri/src/screens/collect.js` — synced `AGGRESSIVE_SOURCES`
  pre-seed list to include `youtube` + the missing trustpilot/rss-bundle
  entries; added rss label entries.
