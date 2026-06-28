# Video ingest via yt-dlp + faster-whisper — full technical design doc

**Date:** 2026-04-21
**Type:** Documentation

## Summary

Wrote `docs/video-ingest.md` — a 22-section design doc for the "paste any video URL → transcript → research row" feature. Covers bundling strategy (ffmpeg + yt-dlp bundled, Whisper model weights user-downloaded from HuggingFace on demand), the yt-dlp auto-update overlay trick (pip-install to a user-writable dir that prepends `sys.path`), full Python module layout, CLI surface, Rust command triangle, UI mockups for the Ingest Video tab and Settings Whisper card, error-class matrix, attack surface, testing strategy, and a 5-pass implementation plan with canonical code snippets ready to drop into Pass 1.

## Design decisions locked this round

- **Models:** HuggingFace direct (`Systran/faster-whisper-*`), no self-hosted mirror.
- **Engine:** `faster-whisper` with CT2 `int8` quantization — 4× speed, same quality as vanilla `openai-whisper`.
- **Default tier:** `small.en` (480 MB) — balance pick. Users can escalate to `medium.en` or `large-v3`.
- **Language:** auto-detect via Whisper on the first 30 s; user can override.
- **Diarization:** deferred to v2 (no `pyannote-audio` bundling).
- **yt-dlp updates:** every launch, 24h cooldown, pip-install into `ytdlp-overlay/` (user-writable, not part of the codesigned bundle), `sys.path` prepended. Graceful fallback to bundled wheel on any failure.
- **Pro-gated feature** per `docs/licensing.md`: trial unlimited, expired-trial disabled, license unlocks fully.

## Files Created

- `docs/video-ingest.md`
- `changelogs/2026-04-21_15_video-ingest-design.md`

## Not yet done (implementation passes, next sessions)

1. Python backend + CLI (`reddit-cli ingest video`, `whisper`, `ytdlp`).
2. Bundle static ffmpeg + wire yt-dlp overlay cold-start.
3. Rust commands + streaming events.
4. Ingest-screen Video tab.
5. Settings Whisper models card.

Each pass is independently shippable and testable. This commit is docs-only so the design can be reviewed and revised before code locks it in.
