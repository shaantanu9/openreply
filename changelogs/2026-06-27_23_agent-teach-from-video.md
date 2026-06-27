# Teach an agent from a video (yt-dlp subtitles → learning)

**Date:** 2026-06-27
**Type:** Feature

## Summary

Added a proper end-to-end flow for an OpenReply agent to **learn from a video**.
Paste a YouTube link on the agent's Knowledge page → the agent pulls the
video's subtitles/transcript (via the existing yt-dlp caption pipeline), distills
it into memories, synthesizes beliefs, and blends that knowledge into its replies
and content. Non-YouTube URLs (Instagram, raw video) fall back to a
yt-dlp-audio → faster-whisper transcript. The underlying yt-dlp + persona-teach
machinery already existed for personas; this wires it to the **agent** level and
exposes it through the CLI, the Tauri command layer, and the UI.

## Flow

1. **Knowledge** screen → "Teach from a video" card → paste a YouTube URL →
   "Learn from video".
2. `agent_teach_video` (Tauri) → `gapmap agent teach-video <url>` (CLI) →
   `reply.learn.teach_for_agent`.
3. `teach_for_agent` resolves (or auto-provisions) the agent's learning persona,
   then calls `persona.teach.teach_from_video`:
   - YouTube → yt-dlp auto-captions/transcript (chunked) + top comments + description
   - other → yt-dlp audio → faster-whisper transcript
4. Transcript rows → same ingest pipeline `learn_for_agent` uses (memories →
   `embed_and_link` → persona ChromaDB) → new memories synthesized into beliefs.
5. Result surfaced in the card (transcript chunks · lessons · beliefs) and via
   the existing Learning screen.

## Verification

Real run against a captioned TED talk on the test agent:
- fetched 31 rows (**10 transcript chunks from yt-dlp captions** + 20 comments +
  1 description)
- **learned 17 lessons**, synthesized **3 beliefs**
- `agent learn-status` then reported 30 memories / 3 beliefs; recent lessons were
  clearly drawn from the video.
- Combined working tree compiles (`cargo check` finished clean).
- Per-batch "unparseable batch json" events from the small BYOK model are
  non-fatal (gracefully skipped; lessons still land).

## Files Created

- `changelogs/2026-06-27_23_agent-teach-from-video.md`

## Files Modified

- `src/gapmap/reply/learn.py` — `teach_for_agent()` (best-effort, never raises)
- `src/gapmap/cli/agent_cmds.py` — `agent teach-video <url>` command
- `app-tauri/src-tauri/src/commands.rs` — `agent_teach_video` Tauri command
- `app-tauri/src-tauri/src/main.rs` — command registration
- `app-tauri/src/or/api.js` — `agentTeachVideo` wrapper
- `app-tauri/src/or/dynamic.js` — Knowledge "Teach from a video" card + wiring

## Notes

- Reuses the existing, sophisticated yt-dlp caption path in
  `sources/youtube.py` (VTT→text, ~1400-char chunking, Whisper fallback for
  caption-less videos) — no new fetch code was needed, only the agent-level
  orchestration + surfacing.
