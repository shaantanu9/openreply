# Video ingest Passes 2–5 — ffmpeg bundle, Rust commands, UI

**Date:** 2026-04-21
**Type:** Feature

## Summary

Completed the remaining four passes of the video-ingest plan from `docs/video-ingest.md`. End-to-end pipeline is now wired: paste a URL in the Tauri app → preview metadata → pick a Whisper tier → local transcription → transcript chunks land in the topic's corpus alongside Reddit / HN / arXiv rows. All handled via bundled binaries + local Whisper — no cloud round-trip for audio.

## Pass 2 — ffmpeg resolver + sidecar env wiring

- `app-tauri/src-tauri/src/cli.rs`
  - New `resolve_ffmpeg_path(app)` — picks bundled → dev drop-in → system PATH.
  - `build_sidecar_cmd` pre-injects `GAPMAP_FFMPEG_PATH` on every sidecar spawn.
  - `run_dev_python_cli` + `run_dev_python_streaming` also propagate the env so dev-venv mode gets the same path.
- `scripts/fetch-ffmpeg.sh` — downloads a static arm64 ffmpeg into `app-tauri/src-tauri/binaries/`, chmod +x, strips quarantine.
- `app-tauri/src-tauri/binaries/README.md` — explains the resolver order + how to wire the binary into `tauri.conf.json` → `externalBin`.
- `.gitignore` — exclude the 30 MB static ffmpeg blob.

## Pass 3 — Rust commands + JS bindings

- `commands.rs` — 9 new `#[tauri::command]`s: `ingest_video_preview`, `ingest_video` (streaming via `run_cli_streaming`, events `video:progress` + `video:done`), `whisper_list`, `whisper_catalogue`, `whisper_download` (streaming, events `whisper:download-progress` + `whisper:download-done`), `whisper_delete`, `whisper_set_default`, `ytdlp_version`, `ytdlp_update`.
- `main.rs::generate_handler` — all 9 registered (the command triangle).
- `api.js` — JS bindings: `videoPreview`, `ingestVideo`, `whisperList`, `whisperCatalogue`, `whisperDownload`, `whisperDelete`, `whisperSetDefault`, `ytdlpVersion`, `ytdlpUpdate`.

## Pass 4 — Ingest screen Video tab

- New screen `app-tauri/src/screens/ingest_video.js` at route `#/ingest-video`.
  - URL field with auto-preview on paste / Enter.
  - Preview card shows title, channel, duration, thumbnail + "cached — re-ingest instant" badge when the transcript already exists.
  - Model dropdown populated from `api.whisperCatalogue()` (only installed tiers + `auto`); ETA hint uses `duration_s × rtf`.
  - Topic picker (existing topics dropdown + new-topic input).
  - Language picker (defaults to auto-detect).
  - Progress log wired to `video:progress` / `video:done` events; success path signals the topic corpus updated.
- `app-tauri/src/screens/ingest.js` — header adds a "Video URL →" button linking to the new screen.
- `app-tauri/src/main.js` — route `#/ingest-video` + import `renderIngestVideo`.

## Pass 5 — Settings "Whisper models" card

- `app-tauri/src/screens/settings.js`
  - New card `#card-whisper` in the settings grid, spans both columns.
  - Installed vs Available tiers with per-row **Download** / **Delete** / **Set default** buttons (live-updating progress line during download via `whisper:download-*` events).
  - "small.en" tagged `recommended` pill.
  - Sub-section: yt-dlp overlay-updater status (`installed vs latest`) with "update available" pill + manual "Check now" button.
  - `fillWhisperCard(root, catalogueRows, ytdlpVer)` loaded in parallel with the other async cards from `renderSettings`.

## End-to-end smoke test (after `uv pip install -e '.[video]'`)

1. Open Settings → Whisper models → Download `small.en` (480 MB from `Systran/faster-whisper-small.en`).
2. Ingest → click **Video URL →** → paste a YouTube link → Preview shows title + duration + ETA.
3. Pick a topic (existing or new) → Transcribe. Progress log streams `{"_progress": {...}}` lines.
4. On completion, the transcript chunks appear in that topic's Evidence tab under `source_type='video'`.
5. Click a chunk's URL → opens the video at the exact `?t=<seconds>` timestamp the quote was spoken.

## Files Created

- `scripts/fetch-ffmpeg.sh`
- `app-tauri/src-tauri/binaries/README.md`
- `app-tauri/src/screens/ingest_video.js`
- `changelogs/2026-04-21_18_video-ingest-passes-2-3-4-5.md`

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — `resolve_ffmpeg_path`, pre-inject env in `build_sidecar_cmd`, propagate in dev paths.
- `app-tauri/src-tauri/src/commands.rs` — 9 new `#[tauri::command]`s.
- `app-tauri/src-tauri/src/main.rs` — register the 9 new commands.
- `app-tauri/src/api.js` — 9 new bindings.
- `app-tauri/src/main.js` — route `#/ingest-video`, import `renderIngestVideo`.
- `app-tauri/src/screens/ingest.js` — header link to Video URL screen.
- `app-tauri/src/screens/settings.js` — Whisper models card + `fillWhisperCard`.
- `.gitignore` — exclude `app-tauri/src-tauri/binaries/ffmpeg-aarch64-apple-darwin`.

## Verification

- `cargo check` (app-tauri/src-tauri) — clean (no warnings, no errors).
- `node --check` on every new/modified JS file — syntax OK.
- `pytest -q tests/transcribe/ tests/ --ignore=tests/test_integration.py` — 62 passed, 1 skipped (unchanged from Pass 1).
- Existing JS test suite — 10/10 pass.

## What's needed to actually run it end-to-end

1. `uv pip install -e '.[video]'` — pulls yt-dlp, faster-whisper, huggingface_hub, packaging.
2. `bash scripts/fetch-ffmpeg.sh` — drops the static arm64 ffmpeg into `binaries/`.
3. Start the app (`npm run tauri dev` inside `app-tauri/`).
4. Settings → Whisper models → Download `small.en`.
5. Ingest → Video URL → paste any YouTube link → Transcribe.

All five passes are idempotent and independently reversible — the feature gracefully falls back when deps / binaries are missing (Python side raises a clean error with hint; UI surfaces it via the `video:done` error classes listed in `docs/video-ingest.md §15`).
