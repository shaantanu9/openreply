# YouTube transcripts + descriptions land in the corpus

**Date:** 2026-05-12
**Type:** Feature

## Summary

Before this pass, the YouTube source only persisted the top-N comments per
video. The video itself — its description and what the speaker actually said —
was never written to the corpus. That meant a persona agent could "learn" from
how people reacted to a video but never from the content of the video. This
adds yt-dlp-backed transcript + description fetching so each YouTube collect
produces three kinds of `posts` rows per video: comments
(`source_type='youtube'`), one description row (`source_type='youtube_description'`),
and one or more ~1400-char transcript chunks (`source_type='youtube_transcript'`).
Persona ingest needs zero code changes — its `SELECT p.id, p.title, p.selftext,
p.source_type FROM posts p JOIN topic_posts tp ON ...` query
(persona/ingest.py:83) is already source-agnostic. The next time a persona
runs ingest on a topic that has YouTube videos in it, the LLM filter sees
both the speaker's words and the surrounding commenter reactions.

## Changes

- Added a WebVTT → plain-text parser (`_vtt_to_text`) that strips the file
  header block (everything before the first cue), inline karaoke timestamp
  tags (`<00:00:01.500>`, `<c.colorE5E5E5>`), `NOTE` blocks, HTML entities,
  and consecutive duplicate lines (yt-auto-captions repeat the tail of each
  cue at the head of the next for accessibility — leaving those in would
  spam ChromaDB recall with near-identical chunks).
- Added a transcript chunker (`_chunk_transcript`) that splits on sentence
  boundaries at ~1400 chars (below the 1500-char body trim in
  persona/ingest.py:194 so chunks survive intact) with no overlap, capped at
  24 chunks per video to prevent a single hour-long lecture from
  monopolising the persona graph.
- Added a caption-URL picker (`_pick_caption_url`) that prefers manual subs
  over auto-captions, prefers `en` / `en-US` / `en-GB` / `en-orig` /
  `en-auto` over other languages, and prefers the `vtt` format over
  `srv3`/`srv2`/`srv1`/`ttml`. Falls back gracefully to any non-priority
  language if no English track exists.
- Added `_video_meta_via_ytdlp(video_id, video_title)` that asks yt-dlp for
  subtitles + auto-captions in one `extract_info` call, downloads the chosen
  caption track via httpx, parses + chunks it, and emits posts-shaped rows
  with `source_type='youtube_transcript'` / `'youtube_description'`. Row
  shape mirrors comments so `_persist` works unchanged.
- Exposed `fetch_youtube_video_meta(video_id, video_title="")` as the public
  surface alongside `fetch_youtube_comments`. Returns `[]` on missing yt-dlp
  or videos with neither subs nor description — callers treat absence as a
  soft miss (the comments path still runs).
- Wired `collect_adapter.run_youtube` to call `fetch_youtube_video_meta` for
  every video alongside `fetch_youtube_comments` and persist the union under
  the same `source_tag=f"youtube:{vid}"`. The return value still counts
  total inserted rows for back-compat.

## Caveats

- **No API-fallback path for transcripts.** YouTube Data API v3's caption
  endpoint requires OAuth + per-video billing; if `yt-dlp` is unavailable,
  comments still flow (via the API key) but transcripts don't.
- **Captions can be missing.** Music videos, shorts, and channels that
  disable auto-captions return no caption track. The fetcher returns an
  empty list quietly; comments handle these cases on their own.
- **Description rows truncate at 4000 chars** (descriptions can be very long
  on tutorial channels). The ingest body trim at persona/ingest.py:194 then
  cuts them to 1500 chars — fine, descriptions are mostly opener +
  bibliography + sponsor copy.
- **Transcript embedding cost.** Each ~1400-char chunk becomes one
  `persona_memories` row and one ChromaDB embedding. A 30-minute video that
  fills all 24 chunks adds ~24 persona memories per active persona, per
  topic. The hard cap (`_TRANSCRIPT_MAX_CHUNKS = 24`) keeps that bounded;
  bump it later only if recall feels thin on long-form content.

## Files Modified

- `src/reddit_research/sources/youtube.py` — added `html`, `re` imports;
  new constants `_TC_LINE_RE`, `_INLINE_TAG_RE`, `_TRANSCRIPT_MAX_CHUNKS`,
  `_TRANSCRIPT_CHUNK_CHARS`, `_TRANSCRIPT_LANG_PRIORITY`; new functions
  `_vtt_to_text`, `_chunk_transcript`, `_pick_caption_url`,
  `_fetch_caption_text`, `_video_meta_via_ytdlp`,
  `fetch_youtube_video_meta`.
- `src/reddit_research/sources/collect_adapter.py` — `run_youtube` now
  imports `fetch_youtube_video_meta`, calls it per video, and concatenates
  the rows before `_persist`. Same `source_tag` → same `topic_posts`
  join → automatic visibility to persona ingest.
