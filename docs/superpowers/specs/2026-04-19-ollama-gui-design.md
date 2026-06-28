# Ollama fully-from-GUI — design

**Date:** 2026-04-19
**Status:** Phase 1 shipped in same session. Phase 2–3 pending.

## Goal

Make every Ollama operation accessible from the Tauri app GUI so users never
need to touch a terminal to run a local model. Keep Ollama as the runtime
(don't bundle llama.cpp yet — that's future scope, see
`docs/manual-todo/future-scope-bundled-local-llm.md`).

## Current state (what exists, what's missing)

| Capability | Before | After Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| Detect Ollama installed | ❌ | ❌ (same) | ✅ `which ollama` | ✅ |
| Detect Ollama running | ✅ (direct ping) | ✅ auto-fires on open | ✅ | ✅ |
| Start `ollama serve` | ❌ | ❌ | ✅ one-click button | ✅ |
| Stop service | ❌ | ❌ | ✅ | ✅ |
| List installed models | ✅ | ✅ full-width grid, size+params | ✅ | ✅ |
| Pick default model | ✅ (chip click) | ✅ active chip highlighted | ✅ | ✅ |
| Test model inference | ✅ but broken | ✅ auto-resolves model from live list | ✅ | ✅ |
| Pull a new model | ❌ | ❌ | ✅ with streaming progress | ✅ |
| Delete a model | ❌ | ❌ | ✅ | ✅ |
| Curated "Recommended" picker | ❌ | ❌ | ✅ Gemma 3 / Llama 3.2 / Qwen 2.5 | ✅ |
| Install Ollama from app | ❌ | ❌ | ❌ | ✅ download .pkg, open Installer |

## Phase 1 (shipped 2026-04-19)

Fix existing flow so the user can reliably set Ollama as their default
provider without terminal help.

- **Bug fix**: Test button sent empty model, Python fell back to hardcoded
  `llama3.1`, user got 404. Fixed by resolving from live `/api/tags` list.
- **Bug fix**: `byok_status` returned Ollama URL under key `ollama_base_url`,
  but frontend readiness checks looked for `byok.ollama`. Added alias in
  `commands.rs::byok_status` — Settings + Welcome now correctly show "ready".
- **UX**: Auto-ping + auto-list on BYOK open. Status pill shows `● running ·
  N models` (green) or `● offline` (red) without user clicking anything.
- **Layout**: Model chips now render below the action buttons in a full-width
  flex-wrap grid instead of being squeezed as a flex sibling. Active model
  highlighted with ✓ and filled green background.
- **Responsive**: `.settings-card { overflow: hidden; min-width: 0 }` plus
  `.settings-toggle span { min-width: 0; overflow-wrap: anywhere }` fixes the
  Preferences-card overflow seen at medium widths.

Files touched:
- `app-tauri/src/screens/byok.js`
- `app-tauri/src-tauri/src/commands.rs` (+ `ollama` alias)
- `app-tauri/src-tauri/src/cli.rs` (PYTHONUNBUFFERED=1 for live log streaming)
- `app-tauri/src/screens/welcome.js`
- `app-tauri/src/screens/settings.js`
- `app-tauri/src/style.css`

## Phase 2 (planned, ~1 day)

**Service-management buttons** on the Ollama row:
- `Start service` — when ping fails, offer to spawn `ollama serve` in the
  background via a new Rust command `start_ollama()` that returns as soon
  as the daemon is reachable (poll /api/version).
- `Stop service` — when running, offer to kill the daemon (`pgrep ollama
  | xargs kill`).

**Model management** in the Ollama tab:
- `+ Pull model` button opens a sub-modal with:
  - Curated tab (Gemma 3 1B/4B, Llama 3.2 3B, Qwen 2.5 3B/7B, DeepSeek R1)
    with size + RAM hints, one-click pull.
  - Custom tab — free-form input e.g. `hf.co/...:Q4_K_M`.
  - Progress: stream the Ollama `/api/pull` NDJSON response, show %
    downloaded + MB/s.
- Per-chip `Delete` button (confirm) — calls `/api/delete`.

Backend needed:
- New Rust commands: `start_ollama`, `stop_ollama`, `ollama_pull`,
  `ollama_delete`, `ollama_install_status`.
- `ollama_pull` streams NDJSON events via a `model:pull:progress` Tauri event,
  same pattern as `collect:progress`.

## Phase 3 (nice to have)

- Detect if Ollama is installed at all (`which ollama`). If not, offer to
  download + run the `Ollama.dmg` installer from inside the app (one-click
  first-run). Risky (Installer prompts, admin password) — defer.

## Tested working after Phase 1

- User has Ollama 0.9.3 locally, 7 non-embedding models installed.
- Sidecar `reddit-cli research test-llm --provider ollama --model qwen2.5:7b`
  returns `{"ok": true, "reply": "OK"}` in ~1.5 s warm / ~28 s cold.
- BYOK modal auto-lists models on open, chip selection saves
  `LLM_PROVIDER=ollama` + `LLM_MODEL=<chosen>` to `~/.config/reddit-myind/.env`.

## Not in scope

- Bundling llama.cpp / Gemma directly — separate design at
  `docs/manual-todo/future-scope-bundled-local-llm.md`.
- Auto-updating Ollama itself.
- Multi-host Ollama (pointing at a remote box) — users can already type any
  URL into the base-URL input; no dedicated flow needed.
