# Persona "teach from video" now accepts Instagram (Whisper) — not just YouTube

**Date:** 2026-05-31
**Type:** Feature

## Summary

You can now teach a persona ("second brain") from **Instagram** reels/posts as
well as YouTube. Paste a link in the persona's "Teach from a video" card → the
video is transcribed → distilled into the persona's memories → embedded into its
per-persona ChromaDB ("mirofish") → chat answers ground in it.

- **YouTube** keeps the fast existing path (yt-dlp captions + description + top
  comments).
- **Instagram / any other URL** uses the Whisper transcript path (yt-dlp pulls
  audio → faster-whisper transcribes on-device, since IG has no captions).

Spec: `docs/superpowers/specs/2026-05-31-persona-video-teach-design.md`
Plan: `docs/superpowers/plans/2026-05-31-persona-video-teach.md`

## How it works

A new router `teach_from_video(persona_id, url)` classifies the URL and
dispatches:
- `youtube` → existing `teach_from_youtube` (unchanged).
- `instagram` / `other` → new `teach_from_media`: `sources/video.fetch_video`
  (yt-dlp audio → faster-whisper → posts-table rows) → the SAME
  `upsert_posts → _tag_posts → ingest_persona` tail YouTube uses, so persona
  memory + graph are identical regardless of source.

The Tauri app already had the full teach flow wired for YouTube
(`persona_agent_teach_video` Rust command → `api.personaTeachVideo` →
`personas.js` "Teach from a video" card). Because that command calls
`persona teach-video <id> <url>` and the CLI now routes by URL, **Instagram
works through the existing UI** — only the card's copy/placeholder needed
updating to mention it.

## Files Modified

- `src/openreply/persona/teach.py` — `parse_instagram_url`, `classify_video_url`,
  `_fetch_media_rows`, `teach_from_media`, `teach_from_video` router.
- `src/openreply/persona/__init__.py` — re-export the new functions.
- `src/openreply/cli/persona_cmds.py` — `persona teach-video` calls the router
  (accepts YT + IG URLs).
- `app-tauri/src/screens/personas.js` — teach card copy + placeholder now say
  "YouTube or Instagram"; note IG is transcribed on-device.

## Files Created

- `tests/test_persona_teach_video.py` — 6 tests (URL parse/route, Whisper teach,
  IG-login soft-error, empty transcript).

## Error handling

- Instagram private / age-gated / rate-limited → soft `teach:error` event with a
  "needs a public reel or login cookies" hint; the stream still closes cleanly
  (never crashes the worker).
- Empty transcript → `done` with 0 kept; persona unchanged.

## Verification

- `pytest tests/test_persona_teach_video.py` — 6/6 pass.
- Package + CLI import clean; `persona teach-video --help` shows the new routing.
- `npm run build` succeeds.

## Notes / follow-ups

- **Sidecar rebuild required for the installed DMG** (`scripts/build-pyinstaller.sh`
  → copy → codesign) so the bundled CLI has the routing. Dev mode works now.
- Phase 2 (fine-tune the persona's offline brain on accumulated transcripts) is
  designed but deferred — see the spec.
- The "Comments" field in the teach card is YouTube-only (ignored for IG).
