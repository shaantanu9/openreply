# Expose YouTube (comments + transcripts) in the collect source picker

**Date:** 2026-06-06
**Type:** Fix

## Summary

Audited the YouTube transcription + comments pipeline end-to-end. The backend
(`youtube.py` → `run_youtube`) is fully implemented and working: it searches
YouTube by topic keywords via yt-dlp (no API key/quota), pulls top-voted
comments, the video description, and the caption transcript (manual subs >
auto-captions, chunked ~1400 chars), then persists all of it into the `posts`
table tagged to the topic — where it is embedded into the ChromaDB palace and
consumed by the LLM stages (insights, sentiment-by-source, report, personas).

The one real gap: `youtube` was registered in the backend `SOURCES` dispatch
map and included in the **aggressive** default sweep (`collect.py`), but it was
**missing from `ALL_SOURCES` in the UI source picker** (`topic.js`). Result:
any user who opened "Rerun collect" and customized sources — or had a saved
per-topic source set — silently dropped YouTube, because the explicit
`--sources` list the picker sends could never contain `youtube`. Added the
tile (default-on) so YouTube flows on every UI-driven collect, not just the
no-picker aggressive path.

Verified live: search returned 3 videos in ~2s, comments fetched, and
description + 6 transcript chunks extracted — all in the correct posts row
shape (`source_type` = youtube / youtube_description / youtube_transcript).

## Changes

- Added a `youtube` tile to the `ALL_SOURCES` array in the collect source
  picker, group `social`, `defaultOn: true`, labelled
  "YouTube (comments + transcripts, yt-dlp)".
- No backend change needed — `run_youtube`, the `SOURCES["youtube"]` dispatch,
  the corpus_format labels, the sentiment-by-source `youtube` rollup, and the
  topic.js source-breakdown normalization (`youtube%` → `youtube`) were
  already in place and verified working.

## Files Modified

- `app-tauri/src/screens/topic.js` — inserted the `youtube` source tile into
  `ALL_SOURCES` (after `stackexchange`).

## Notes / not changed

- Separate user-submitted-video flow (`video.py` → `ingest_video.js`, paste any
  YouTube/Vimeo/podcast URL → faster-whisper on-device transcription,
  `source_type='video'`) is a distinct, already-working feature and untouched.
- Non-aggressive ("quick") collect still omits YouTube from its baseline list
  by design (it adds per-video fetch latency); aggressive + picker now both
  include it.
