# Persona "teach from a video" — surgical learning path

**Date:** 2026-05-12
**Type:** Feature

## Summary

Personas can now be taught from a single YouTube video on demand. The user
pastes a URL on the persona's Ingest tab and the persona reads that one
video's transcript, description, and top comments — filtered through its
lens — without touching any other content in the corpus. Conceptually it's
"child, watch this video, learn from it" as opposed to the existing
"scan everything you haven't read yet" pass. The streamed event log mixes
fetch-phase (`teach:start`, `teach:fetched`) and ingest-phase
(`start`, `memory`, `skip`, `done`) events into one unified view so the
user can see exactly what was extracted from where.

## How it works

1. **Fetch** — `persona/teach.py::teach_from_youtube` parses the URL (any
   of the seven YouTube URL families plus bare 11-char ids), then calls
   `sources.youtube.fetch_youtube_comments` + `fetch_youtube_video_meta`
   (the latter shipped earlier today in changelog 06) to materialise
   comment, description, and transcript-chunk rows.
2. **Persist** — rows are upserted into the `posts` table and tagged into
   `topic_posts` under the persona's own lens with a `source="teach:p{id}:v{vid}"`
   prefix. The prefix bypasses `research.collect._tag_posts`'s semantic
   relevance gate so an unrelated-but-deliberately-chosen video doesn't
   get silently dropped by the embedder.
3. **Ingest** — the rows are handed to `ingest_persona(post_ids=[...])`
   via a new explicit-list selector on `_candidate_posts`. The
   NOT-EXISTS already-ingested filter still applies, so re-teaching the
   same video is a no-op.

The teach stream reuses the existing `persona_ingest:progress` /
`persona_ingest:done` event channels so no new listeners are needed on
the UI side.

## Why this design

- **No synthetic topics in the topics list.** Tagging under the persona's
  lens (instead of `_taught:p{id}:v{vid}`) keeps the topic listing
  semantically meaningful — when the user opens the lens topic elsewhere
  in the app, the new corpus content is just there. Surgical scoping
  comes from the `post_ids` selector on ingest, not from a special topic.
- **Skip the relevance gate for explicit teaches.** The gate exists to
  reject Reddit/HN search drift ("meditation" matching r/politics).
  Explicit "teach this persona this URL" is the opposite kind of intent —
  the user has already curated, so dropping rows for "not similar enough
  to lens" would be silently wrong. The skip is gated on the `teach:`
  source prefix to keep the gate active for everything else.
- **One stream, one log.** Reusing the `persona_ingest:*` channels and
  pattern-matching by `event` keeps the UI simple and means future
  surgical-teach sources (a paper URL, a Reddit thread URL) inherit the
  log infrastructure for free.

## Test surface

- Python syntax check on the seven touched files.
- 19 URL-parser cases pass: all seven URL families, bare id, leading/
  trailing whitespace, embedded-in-prose URL, plus six negative cases
  (empty, non-YouTube domain, 10-char id, 12-char bare id, etc.).
- `node --check` clean on `personas.js` and `api.js`.

## Caveats

- **yt-dlp is required.** The Data API fallback can't fetch transcripts
  (OAuth/billing), so videos with no captions yield only comments.
  Videos with no captions and no comments yield zero rows and the
  persona reports `kept=0 dropped=0 errors=0`.
- **Comments are still capped at 100 by default.** The UI input lets the
  user tune 0..500. Setting to 0 teaches transcript+description only.
- **The persona stays scoped to its lens.** If the LLM filter judges the
  video not relevant to the persona's lens (e.g. teaching a market-gap
  persona a meditation video), most rows return `relevant=false` and the
  log shows mostly `skip` events. The persona learns nothing, which is
  the correct behaviour — the lens is the persona's defining constraint.

## Files Created

- `src/reddit_research/persona/teach.py` — URL parser
  (`parse_youtube_id`) + the main `teach_from_youtube` generator.

## Files Modified

- `src/reddit_research/persona/ingest.py` — `_candidate_posts` and
  `ingest_persona` now accept an optional `post_ids: list[str]`
  selector that overrides the topic filter.
- `src/reddit_research/persona/__init__.py` — re-exports
  `teach_from_youtube` and `parse_youtube_id`.
- `src/reddit_research/cli/persona_cmds.py` — new
  `persona teach-video <persona_id> <url>` Typer command that streams
  NDJSON via `_emit`, handles both the `teach:*` and standard ingest
  event shapes in human-readable mode.
- `src/reddit_research/research/collect.py` — extended the
  `_tag_posts` relevance-gate skip predicate from `local:*` to
  `local:* | teach:*` so explicit teach actions bypass semantic
  filtering on the user's behalf.
- `app-tauri/src-tauri/src/persona_cmds.rs` — new
  `persona_agent_teach_video` Tauri command that wraps the CLI and
  streams progress on the existing `persona_ingest:*` channels.
- `app-tauri/src-tauri/src/main.rs` — registered
  `persona_agent_teach_video` in the `generate_handler!` list.
- `app-tauri/src/api.js` — new `personaTeachVideo(personaId, url, opts)`
  wrapper; reuses `onPersonaIngestProgress` / `onPersonaIngestDone`.
- `app-tauri/src/screens/personas.js` — `mountIngestTab` rewritten to
  show a "Teach from a video" card above the existing scan-corpus
  panel, plus a `renderEvent` helper that handles the regular ingest,
  peer ingest, AND the new `teach:*` event types in one shared log.
  Submit button shows a loader while teaching; Enter in the URL field
  submits the form.
