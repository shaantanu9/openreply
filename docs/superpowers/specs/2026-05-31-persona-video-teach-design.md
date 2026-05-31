# Persona "teach from video" — YouTube + Instagram → mirofish memory

**Date:** 2026-05-31
**Status:** Approved design (ready for implementation plan)

## Goal

A user creates a persona ("second brain"), then **shares YouTube and Instagram
video URLs to that persona**. Each video is converted to proper text, distilled
into the persona's memories, embedded into its per-persona ChromaDB memory
palace ("mirofish"), and the persona answers the user's questions grounded
(with citations) in everything shared. RAG now; optional local fine-tune later.

## What already exists (reuse, do not rebuild)

- `persona/ingest.py::teach_from_youtube(persona_id, url)` — YT URL → yt-dlp
  **auto-captions** + description + top comments → LLM distills "memories"
  (lessons) → `embed_and_link` into the persona's Chroma collection + graph.
- `persona/ingest.py` distillation + `embed_and_link` (Phase-2a embed).
- `persona/chat.py` — RAG over the persona's Chroma collection
  (`_retrieve_semantic`, keyword fallback) → grounded answer. This is the
  "mirofish learning" link (per-persona memory palace).
- `sources/video.py` — yt-dlp → faster-whisper transcript for **any URL**
  (`transcribe_audio`); already source-agnostic, audio-based (works for IG).
- `transcribe/` package (whisper, ytdlp_client w/ self-update overlay).
- Persona create / list / memories / conclusions / chat (CLI + MCP + screen).
- `screens/personas.js` + persona chat UI.

## What is new (the gaps)

1. **`teach_from_video(persona_id, url, *, provider=None)`** in `persona/ingest.py`
   — a router that converges on the existing distill→embed pipeline:
   - **YouTube** host (`youtube.com`, `youtu.be`, bare 11-char id) → delegate to
     the existing `teach_from_youtube` (captions + comments + description). No
     behavior change for YT.
   - **Instagram** host (`instagram.com/reel|p|tv|stories`) → **Whisper path**:
     pull audio via `sources/video.py` → `transcribe_audio` → transcript text
     (+ any caption/description yt-dlp returns in metadata) → feed the SAME
     distill→embed path `teach_from_youtube` already uses (rows → LLM-distilled
     memories → `embed_and_link`), so persona memory + graph are identical
     regardless of source. (Refactor `teach_from_youtube` so its
     rows→memories tail is a shared helper both branches call.)
   - **Other** hosts → default to the Whisper path (generic media).
   - Streams the same NDJSON event shapes teach already emits
     (`teach:start`, `teach:fetched`, `start`, `memory`, `skip`, `error`,
     `done`) so the UI is source-agnostic.

2. **CLI**: extend `persona teach-video` (or add `persona teach-media`) to accept
   any URL and call `teach_from_video`. Keep `--json` NDJSON streaming.

3. **Rust streaming command** `persona_teach_media(persona_id, url)` →
   `run_cli_streaming` (its own progress/done events; Whisper is 30-90s). Plus
   `main.rs` `generate_handler` registration + `api.js` wrapper (the
   command-registration triangle).

4. **UI** on `screens/personas.js` persona detail: a "Teach from a video" URL
   input (YT or IG) → streams transcribe→teach progress (reuse the alive-loader
   pattern) → on done, refresh the persona's memories. Chat already exists and
   will answer from the new memories.

## Data flow

```
create persona ──► paste YT/IG URL ──► teach_from_video(persona_id, url)
   YouTube ─► teach_from_youtube ─► yt-dlp captions + desc + comments ┐
   Instagram ─► sources/video.transcribe_audio (yt-dlp audio→whisper) ┤─► rows
   other ─────► (whisper, generic) ───────────────────────────────────┘
        rows ─► LLM distill → persona "memories" (lessons)
             ─► embed_and_link → persona Chroma collection (mirofish) + graph
   chat(persona, question) ─► _retrieve_semantic (RAG) ─► cited answer
```

## Error handling

- **Instagram needing login/cookies** (private posts, rate-limit): yt-dlp
  raises; surface a clear `error` event ("Instagram needs login — public reels
  only, or add cookies") instead of a silent failure. Don't crash the stream.
- **No transcript / empty audio**: emit `skip` with reason; persona unchanged.
- **No LLM configured**: emit the standard skip-gracefully shape
  (`{ok:false, skipped:true, reason}`) — never raise (Phase 4 of the sidecar
  skill).
- **Whisper model not downloaded**: faster-whisper fetches on first use; surface
  a "downloading transcription model…" progress line so the 1st IG video isn't a
  silent long wait.

## Testing

- `tests/test_persona_teach_video.py`:
  - URL router: youtube.com / youtu.be / bare-id → YT branch; instagram.com/reel
    → whisper branch; other → whisper branch. (Pure function, mock the two
    backends.)
  - IG-needs-login error → emits `error` event, does not raise, persona memory
    count unchanged.
- Reuse existing persona-ingest / chat tests; no change to that pipeline.

## Phase 2 (deferred — "fine-tune later")

Add a dataset-export hook: per persona, dump `(transcript chunk → distilled
memory)` and `(question → grounded answer)` pairs to JSONL. Later: LoRA
fine-tune a small local model (Llama-3.1-8B / Qwen / Phi), eval vs cloud on a
holdout, swap the persona's reasoning to local when it matches. Not built now;
the export hook is the only Phase-1 affordance.

## Out of scope

- OS share-sheet / mobile share (desktop paste-URL only for now).
- Non-video Instagram (image carousels — OCR) — videos/reels only.
- Multi-persona fan-out of one video (user picks one persona per share).
