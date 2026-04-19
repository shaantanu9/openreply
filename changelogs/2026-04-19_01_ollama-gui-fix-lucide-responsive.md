# Ollama GUI fixes, Lucide icons, and responsive layout pass

**Date:** 2026-04-19
**Type:** Fix + UI Enhancement + Infrastructure

## Summary

Fixed the BYOK Ollama Test button (was returning 404 because the Python side
fell back to hardcoded `llama3.1` when `LLM_MODEL` wasn't set). Fixed the
`byok.ollama` vs `byok.ollama_base_url` key mismatch that made Settings +
Welcome show "0 ready" even when Ollama was configured. Fixed a CSS overflow
bug in the Settings Preferences card (toggle text overflowing the card
boundary at medium widths). Installed and wired Lucide icons across the
sidebar and every major screen. Set `PYTHONUNBUFFERED=1` on the sidecar spawn
so collect progress lines stream live instead of in buffered chunks.

## Changes

- **BYOK Test button**: now auto-resolves a model from the live `/api/tags`
  list when no `LLM_MODEL` is saved. Shows "No models installed" with a
  pull-command hint if Ollama has nothing.
- **BYOK Ollama row**: auto-pings + auto-lists on modal open; status badge
  (`● running · N models` / `● offline`); full-width model grid below actions;
  active model highlighted with ✓; live model-list refresh after pick.
- **Default-provider tab**: picking Ollama in the selector now fetches live
  models and suggests the first installed one (no static `llama3.1` fallback).
- **Rust byok_status**: added `ollama` key (aliases `OLLAMA_BASE_URL`) so all
  frontend readiness checks work uniformly.
- **Rust sidecar spawn**: added `PYTHONUNBUFFERED=1` env in `run_cli`,
  `run_cli_streaming`, `run_cli_chat_streaming` — collect/chat progress now
  streams live.
- **Lucide icons** installed (`lucide` npm dep) + `src/icons.js` helper +
  global `refreshIcons()` after every route render. Icons swapped in:
  sidebar nav (8 items), BYOK modal (close, refresh, ping), settings
  (Manage keys), welcome (Add key, Install Ollama), home (4 stat cards +
  activity feed items + BYOK prompt), collect (Copy log, Clear, Retry),
  topic (Rerun, Rebuild, Retry, Copy markdown, Regenerate, chat preset icons
  for 5 modes, Add LLM key, Keys, Add a key), reports (Refresh, Copy),
  activity (Refresh), database (CSV, Copy JSON, row-modal close).
- **Responsive CSS**:
  - `.settings-card { min-width: 0; overflow: hidden; }` — prevents grid blowout
  - `.settings-toggle span { min-width: 0; overflow-wrap: anywhere; }` — fixes
    Preferences card overflow
  - `.llm-chip-name { overflow: hidden; text-overflow: ellipsis; }` — truncates
    long provider names
  - `.llm-grid` switches to 1-col at `≤960px` (was `≤720px`)
  - Added `svg` sizing rules for `.nav-ic`, `.stat-icon`, `.activity-ic`,
    `.chat-preset-ic`, `.byok-prompt-ic`, `.pill`, `.llm-chip-state`,
    `.icon-btn`

## Files Created

- `app-tauri/src/icons.js` — Lucide bootstrap helper
- `docs/manual-todo/future-scope-bundled-local-llm.md` — llama.cpp + Gemma
  bundled-DMG path for later
- `docs/superpowers/specs/2026-04-19-ollama-gui-design.md` — full design for
  the Ollama-from-GUI work (Phase 1 shipped here, Phase 2–3 planned)
- `changelogs/2026-04-19_01_ollama-gui-fix-lucide-responsive.md` — this file

## Files Modified

- `app-tauri/package.json` / `package-lock.json` — added `lucide` dep
- `app-tauri/index.html` — sidebar nav uses `<span class="nav-ic"><i data-lucide="…"></i></span>`
- `app-tauri/src/main.js` — imports `refreshIcons`, calls it at end of `route()`
- `app-tauri/src/style.css` — new `.icon-btn`, `.nav-ic svg`, overflow fixes
- `app-tauri/src/screens/byok.js` — whole Ollama flow reworked
- `app-tauri/src/screens/welcome.js` — Lucide + live-ping probe wire-up (partial)
- `app-tauri/src/screens/settings.js` — Lucide + `refreshIcons()` call
- `app-tauri/src/screens/home.js` — stat icons, activity icons, BYOK prompt
- `app-tauri/src/screens/collect.js` — Copy/Clear/Retry icons
- `app-tauri/src/screens/topic.js` — Rerun/Rebuild/Retry/Copy/Regen/chat-preset icons
- `app-tauri/src/screens/reports.js` — Refresh/Copy icons
- `app-tauri/src/screens/activity.js` — Refresh icon
- `app-tauri/src/screens/database.js` — CSV, Copy JSON, row-modal close icons
- `app-tauri/src-tauri/src/commands.rs` — `ollama` alias in `byok_status`
- `app-tauri/src-tauri/src/cli.rs` — `PYTHONUNBUFFERED=1` on all three sidecar spawn helpers
