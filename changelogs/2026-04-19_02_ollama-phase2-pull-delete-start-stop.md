# Ollama Phase 2 — Pull / Delete / Start / Stop from GUI + Collect "Now" banner

**Date:** 2026-04-19
**Type:** Feature

## Summary

Added service-management + model-management buttons to the BYOK Ollama row so
users never have to touch a terminal. Added a curated "Recommended" model
catalog (Gemma 3, Llama 3.2, Qwen 2.5, DeepSeek R1) with one-click pull and
live % progress streaming from Ollama's `/api/pull` NDJSON response. Added a
big "NOW doing X" banner on the Collect screen with an animated spinner so
users get continuous feedback during multi-minute scrapes.

## Changes

- **Rust commands**:
  - `ollama_start_service` — spawns `ollama serve` if not running; resolves
    the binary via `which ollama` with `/usr/local/bin/ollama` fallback.
    Polls port 11434 up to 5s to confirm readiness.
  - `ollama_stop_service` — `pkill -TERM ollama` for a graceful shutdown.
- **BYOK Ollama row**:
  - `Start service` / `Stop service` buttons swap visibility based on
    live ping status (offline → Start; running → Stop).
  - `+ Pull model` button opens a sub-modal with two tabs:
    - **Recommended**: 7 curated models with name/size/RAM hints + one-click pull
    - **Custom**: free-form input for any Ollama tag (incl. `hf.co/...`)
  - Streaming download progress: parses Ollama's NDJSON `/api/pull` stream;
    shows status transitions + live % + MB counter.
  - Each model chip now has a small red `×` delete button that hits
    `DELETE /api/delete` after confirm.
- **Collect screen**:
  - Added a prominent "NOW" banner with spinner + current-action text.
    Every progress line from the sidecar updates the banner in real time.
  - On success / failure, spinner stops and banner shows final state
    (`✓ Done — gap map ready` / `✗ failed`).
- **Welcome Step 4 + Home topic tiles**:
  - Replaced emoji covers (📄 ⏱ 💸 🗒 🧘 🤖) with Lucide icons
    (`file-text`, `check-circle-2`, `receipt`, `notebook-pen`, `flower-2`,
    `terminal`). Home tiles cycle through 8 Lucide icons instead of emoji.
  - `.topic-cover svg` sized to 28px with muted stroke for consistency.

## Files Created

- `changelogs/2026-04-19_02_ollama-phase2-pull-delete-start-stop.md` — this file

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — `+ ollama_start_service`, `+ ollama_stop_service`
- `app-tauri/src-tauri/src/main.rs` — register new commands in `generate_handler!`
- `app-tauri/src/api.js` — `+ ollamaStartService`, `+ ollamaStopService`
- `app-tauri/src/screens/byok.js` — Start/Stop/Pull buttons, delete-per-chip,
  `openPullModelModal` with curated catalog + streaming progress
- `app-tauri/src/screens/collect.js` — "NOW" banner + nowText updates on
  every progress line
- `app-tauri/src/style.css` — `@keyframes nowspin`, `.topic-cover svg` sizing
- `app-tauri/src/screens/welcome.js` — EXAMPLES swapped emoji → Lucide icon names
- `app-tauri/src/screens/home.js` — COVER_EMOJIS → COVER_ICONS (Lucide names)

## Phase 3 still outstanding

Auto-detect whether Ollama is installed at all (`which ollama`). If not, offer
to download + run the `Ollama.dmg` installer from inside the app. Deferred —
not blocking current use since users who don't have Ollama can still use any
of the 7 remote providers.
