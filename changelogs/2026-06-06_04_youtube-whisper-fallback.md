# Whisper fallback for caption-less videos in the bulk YouTube source

**Date:** 2026-06-06
**Type:** Feature

## Summary

Closed the last real gap in the YouTube flow. The topic-driven YouTube source
(`sources/youtube.py` → `run_youtube`) previously got transcripts **only** from
yt-dlp caption tracks; a video with captions disabled yielded the description +
comments but no record of what the speaker actually said. Whisper transcription
existed only in the separate manual paste-a-URL screen (`sources/video.py` /
`ingest_video.js`).

Now, when a topic-collected video exposes **no caption track**, the bulk source
falls back to downloading audio and transcribing it on-device with
faster-whisper — re-using the existing `video.fetch_video()` pipeline and the
same 1400-char chunker the caption path uses, so both transcript sources emit
uniform `youtube_transcript` rows.

The fallback is **capped and gated** per the agreed design:
- **Capped** at `whisper_cap=3` videos per collect (across all keywords) so an
  aggressive sweep can't balloon into 30+ minutes of transcription.
- **Aggressive/rerun only** — `research/collect.py` passes
  `whisper_fallback=aggressive`, so the quick collect stays fast and
  Whisper-free (as required).
- **Soft-miss safe** — if no Whisper model is installed, ffmpeg is missing, or
  the audio download/transcribe fails, it returns `[]` and the collect keeps
  the description + comments. No errors surface.

Verified live: a caption-less-style short video ("Me at the zoo", ~19s)
transcribed via `tiny.en` in 7.6s into a correct `yt_<id>_wx00`
`youtube_transcript` row; the no-model and unavailable-video guards both return
`[]` without raising.

## Changes

- `sources/youtube.py`:
  - Added `_whisper_transcript_rows(video_id, video_title)` — guarded
    (checks `list_installed()` first), reuses `video.fetch_video()`, re-chunks
    via `_chunk_transcript`, emits `youtube_transcript` rows with `_wxNN` ids.
  - `_video_meta_via_ytdlp(...)` gained `allow_whisper` — tracks whether a
    caption transcript was produced and, if not and allowed, appends Whisper
    rows.
  - `fetch_youtube_video_meta(...)` gained the `allow_whisper` passthrough.
- `sources/collect_adapter.py`: `run_youtube(...)` gained `whisper_fallback`
  and `whisper_cap` params; enforces the per-collect budget (`whisper_used`)
  and detects spend via the `_wx` id marker; logs both in `log_fetch_start`.
- `research/collect.py`: `_run_source` special-cases `youtube` to call
  `fn(search_keywords, whisper_fallback=aggressive)`.

## Files Modified

- `src/openreply/sources/youtube.py`
- `src/openreply/sources/collect_adapter.py`
- `src/openreply/research/collect.py`

## Notes

- Quick (non-aggressive) collect is unchanged and never invokes Whisper.
- Whisper rows roll up under the existing `youtube` source bucket (the
  `youtube%` normalization SQL in `topic.js` and the `sentiment_by_source`
  family rollup already collapse `youtube_transcript`).
- Builds on the same-day UI fix (`2026-06-06_03`) that surfaced YouTube in the
  rerun source picker.
