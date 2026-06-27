# Connections & Settings pages — backend restored + UI wired to live data

**Date:** 2026-06-27
**Type:** Fix + Feature

## Summary

The OpenReply Connections and Settings pages were static prototype mockups with
no backend wiring, and the credential backend they depend on was broken: the
`gapmap research cleanup` (commit 5cd3f4f) deleted
`src/gapmap/research/reach_connections.py`, but `cli/main.py` still imported it
in all five `creds` subcommands — so every `creds list/import/save/verify/delete`
crashed with `ImportError`. This change restores the credential backend and wires
both pages to live data through the existing Rust command triangle.

## Changes

- **Backend (Connections):** Recreated `reach_connections.py` and adapted its
  source catalogue for OpenReply. Cookie sources (Reddit, X/Twitter, LinkedIn,
  Xiaohongshu, Xueqiu, Bilibili), API-key sources (Exa), and a new **public**
  credential kind for no-auth sources (Hacker News, Dev.to, Bluesky, Mastodon)
  that shows a live "reachability" check instead of a login. `list_connections`,
  `verify_connection`, `import_browser`, `save_manual`, `delete_connection` all
  return status dicts (never raise). Verified end-to-end: `creds list --json`
  and `creds verify --source hackernews --json` both return valid JSON.
- **Frontend API bridge (`or/api.js`):** Added wrappers for `creds_*`,
  `byok_status`/`byok_set`, `test_llm`, `list_provider_models`,
  `list_ollama_models`, `feeds_*`, `app_data_dir`, `reveal_in_finder`,
  `open_url`, `app_reset_preview`/`app_hard_reset`/`app_relaunch`. All target
  commands already exist in `commands.rs` and are registered in `main.rs`.
- **Connections screen (`or/dynamic.js::renderConnections`):** Live cards from
  `creds list`. Per-kind actions — cookie: Log in (open browser) / Import from
  browser / Paste cookie / Verify / Reconnect / Disconnect; api_key: Add key /
  Get key ↗ / Verify / Remove key; public: Test reach. Inline per-card status.
- **Settings screen (`or/dynamic.js::renderSettings`):** Four live cards —
  (1) AI provider (BYOK) with 9 providers, saved-key detection, Save +
  Test connection (latency/reply); (2) Appearance + refresh cadence persisted
  to localStorage with immediate dark-mode apply; (3) Custom RSS feeds
  (list / validate-add / remove via `feeds_*`); (4) Data & account with data
  dir + size, Reveal in Finder, and a typed-DELETE "Reset all data" flow
  (`app_hard_reset` → `localStorage.clear()` → `app_relaunch`).
- Registered `connections` + `settings` in the `DYN` router so the Tauri app
  renders the live versions (static `views.js` mockups remain the plain-browser
  fallback). `vite build` passes (11 modules transformed).

## Files Created

- `src/gapmap/research/reach_connections.py` — restored + OpenReply-adapted
  credential backend (public/cookie/api_key kinds).

## Files Modified

- `app-tauri/src/or/api.js` — added creds / byok / feeds / data-account wrappers.
- `app-tauri/src/or/dynamic.js` — added `renderConnections` + `renderSettings`
  and registered both in `DYN`.

## Follow-up

- **Prod sidecar rebuild required:** dev mode (`.venv/bin/python`) picks up the
  restored `reach_connections.py` immediately, but the bundled PyInstaller
  sidecar must be rebuilt + re-codesigned before a DMG release (Phase 9 of the
  `tauri-python-sidecar-app` skill) so `creds` works in production.
