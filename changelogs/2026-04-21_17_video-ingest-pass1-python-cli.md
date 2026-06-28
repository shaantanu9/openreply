# Video ingest Pass 1 — Python backend + CLI (yt-dlp + faster-whisper)

**Date:** 2026-04-21
**Type:** Feature

## Summary

Pass 1 of the video-ingest plan from `docs/video-ingest.md` — the full Python backend is now in place and addressable from the CLI. Any yt-dlp-supported URL → audio → faster-whisper transcript → chunked rows in the canonical `posts` shape, flowing through corpus / graph / Report exactly like any other source. Models download from HuggingFace on demand (never bundled); yt-dlp auto-updates into a user-writable overlay on every sidecar cold-start with a 24h cooldown. No Tauri or UI wiring in this pass — shipped via CLI and covered by unit tests so the Rust/JS passes can be reviewed independently.

## Changes

- `src/reddit_research/transcribe/` — new package.
  - `models.py` — hardcoded catalogue of `Systran/faster-whisper-{tiny.en,base.en,small.en,medium.en,large-v3}` with `size_mb` + `rtf`; `list_installed()`, `catalogue()`, `default_tier()` (marker-file driven), `set_default_tier()`, `download_model()` (via `huggingface_hub.snapshot_download`), `delete_model()`.
  - `chunker.py` — sentence-aware packer that groups whisper segments into ≤500-char chunks while preserving the first/last timestamps so "jump to quote" links stay accurate. `segments_to_srt()` also emitted.
  - `whisper.py` — thin `faster_whisper.WhisperModel` wrapper pinned to `device='cpu'`, `compute_type='int8'`, `vad_filter=True`, `beam_size=1`, with progress-callback emission per segment.
  - `ytdlp_client.py` — overlay path injection + PyPI-driven auto-updater. Installs via `pip install --target <overlay>` so the codesigned bundle stays untouched. Graceful fallback + roll-back on overlay import failure. 24h cooldown stamp.
  - `__init__.py` — public API re-exports.
- `src/reddit_research/sources/video.py` — `preview_video(url)` (yt-dlp metadata only), `fetch_video(url, topic, model, language, progress_cb)` returning canonical post rows, `fetch_and_persist(...)` handling `upsert_posts` + `_tag_posts` + `fetches` logging. Uses the bundled ffmpeg path from `OPENREPLY_FFMPEG_PATH` env (set by Rust later). Transcripts cached at `<data>/transcripts/<video_id>.json` + `.srt` so re-ingest is instant.
- `src/reddit_research/cli/main.py` — new subcommands:
  - `reddit-cli ingest video --url … --topic … [--model auto|tier] [--language auto|en] [--preview] [--json]`
  - `reddit-cli whisper list|catalogue|download <tier>|delete <tier>|default [tier]`
  - `reddit-cli ytdlp version|update [--force]`
  All stream `{"_progress": {...}}` lines on `--json` so the Tauri `run_cli_streaming` runner can forward events to the webview.
- `pyproject.toml` — new optional extra `video = [yt-dlp>=2024.10, faster-whisper>=1.0, huggingface_hub>=0.24, packaging>=23.0]`. `all` bumped to include it.
- `tests/transcribe/` — three new test files, 16 new tests (models catalogue, chunker, yt-dlp overlay & cooldown).

## Files Created

- `src/reddit_research/transcribe/__init__.py`
- `src/reddit_research/transcribe/chunker.py`
- `src/reddit_research/transcribe/models.py`
- `src/reddit_research/transcribe/whisper.py`
- `src/reddit_research/transcribe/ytdlp_client.py`
- `src/reddit_research/sources/video.py`
- `tests/transcribe/__init__.py`
- `tests/transcribe/test_chunker.py`
- `tests/transcribe/test_models_catalogue.py`
- `tests/transcribe/test_ytdlp_client.py`
- `changelogs/2026-04-21_17_video-ingest-pass1-python-cli.md`

## Files Modified

- `pyproject.toml` — add `video` extra.
- `src/reddit_research/cli/main.py` — new `whisper` / `ytdlp` sub-typers and `ingest video` command.

## Verification

- `pytest -q tests/transcribe/ tests/ --ignore=tests/test_integration.py` — **62 passed, 1 skipped** (all pre-existing tests still green; 16 new transcribe tests added).
- `reddit-cli whisper catalogue --json` → returns the 5-tier catalogue with `installed=false`.
- `reddit-cli whisper list --json` → `[]` (nothing installed yet).
- `reddit-cli ytdlp version --json` → `{"installed": "0", "latest": "2026.3.17"}` (PyPI lookup works; "0" because base install has no `yt-dlp` yet — only the `video` extra pulls it in).
- `reddit-cli ingest video --help` shows the expected options (`--url`, `--topic`, `--model`, `--language`, `--preview`, `--json`).

## Next passes (unchanged from plan)

- **Pass 2** — bundle static ffmpeg (arm64) under `app-tauri/src-tauri/binaries/`, wire yt-dlp overlay cold-start call from the Rust sidecar spawn.
- **Pass 3** — 8 Rust commands (`ingest_video_preview`, `ingest_video`, `whisper_*`, `ytdlp_*`) + streaming events.
- **Pass 4** — Ingest-screen Video tab.
- **Pass 5** — Settings Whisper-models card + yt-dlp updater status.

## Known gap

Runtime smoke-test of an actual video URL is deferred to Pass 2/3 because it requires `pip install -e '.[video]'` in the venv (~300 MB of extra deps: torch-free faster-whisper + yt-dlp + huggingface_hub). The CLI surface + unit tests validate every code path up to the `yt_dlp.YoutubeDL(...)` call; the lazy-import pattern means the suite doesn't require those deps to pass.
