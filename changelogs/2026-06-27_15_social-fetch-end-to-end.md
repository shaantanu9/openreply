# Social media fetch — properly working, end-to-end

**Date:** 2026-06-27
**Type:** Feature + Fix

## Summary

The social adapters (X, TikTok, Instagram, Threads, Pinterest, Bluesky, TruthSocial,
YouTube, Mastodon, Bilibili, Xiaohongshu, LinkedIn) were already implemented but
didn't actually fetch from the app: they weren't in the default collection pipeline,
the ScrapeCreators / TruthSocial / Bluesky credentials were read **only from env**
(never from the in-app store), and the Connections catalogue was missing the social
unlocks. This change wires them end-to-end — connect a platform in the Connections UI,
verify it, and it's pulled into collection runs ("connect = enabled", with an opt-out
toggle). No new scrapers; this is credential-management + wiring + defaults.

## Changes

- **Adapters read the credential store first, env fallback** so a key/credential pasted
  in the UI reaches the fetcher without a sidecar restart:
  - `sources/_scrapecreators.py::api_key()` → `credentials.api_key("scrapecreators")`
    (one key powers TikTok + Instagram + Threads + Pinterest).
  - `sources/truthsocial.py::_token()` → `credentials.api_key("truthsocial")`.
  - `sources/bluesky.py::_session()` → stored `{handle, app_password}` via new `_creds()`.
- **Credential store gains a use-in-collection flag.** `db.py` adds an
  `enabled INTEGER DEFAULT 1` column to `source_credentials` (ALTER migration for
  existing DBs). `credentials.py` adds `is_enabled()` / `set_enabled()`; `get_credential`
  surfaces `enabled`; `set_credential` preserves it on re-save and defaults new
  connections to enabled.
- **`reach_connections.py` catalogue + new `login_pair` kind.** Added `scrapecreators`
  and `truthsocial` (api_key) and `youtube` (public/keyless); changed `bluesky` from
  `public` → `login_pair` (handle + app-password, so it stops silently 403-ing to
  empty). `_live_check` probes for each; `save_manual` parses `login_pair`;
  `list_connections` emits `enabled` / `unlocks` / `note` / field metadata; new
  `toggle_connection()` and `connected_collection_sources()` (validates names against
  the dispatch map, so reddit/exa_search aren't injected as unknown sources).
- **Collection auto-includes connected social sources.** `collect.py` appends
  `connected_collection_sources()` to the default sweep — only when the caller didn't
  pin an explicit `--sources`, so `--sources x` stays exactly that.
- **Toggle command through the stack.** CLI `creds toggle --source X --enabled/--disabled`;
  Rust `creds_toggle` (commands.rs + main.rs registration); JS `api.credsToggle()`.
- **Connections UI (`or/dynamic.js::renderConnections`).** New status pills
  (connected / needs key / needs login / unreachable), a two-field `login_pair` modal
  (Bluesky handle + app-password), a per-card **"Used in collection"** toggle, and an
  `unlocks` / `note` line (ScrapeCreators shows it powers 4 platforms).
- **Docs.** `docs/SOCIAL_FETCH.md` — per-platform mechanism / credential / endpoint /
  returns / cost / normalize-into-`posts` flow, plus how to verify and extend.

## Verification

- All 8 modified Python files parse; backend smoke test passes: catalogue exposes the
  new sources, `bluesky` is `login_pair` with handle/app_password fields, ScrapeCreators
  unlocks `[tiktok, instagram, threads, pinterest]`, login_pair save stores the pair,
  toggle on/off flips `is_enabled`, and `connected_collection_sources()` resolves to
  valid dispatch names.
- `vite build` passes (11 modules transformed).

## Files Created

- `docs/SOCIAL_FETCH.md`
- `docs/superpowers/specs/2026-06-27-social-fetch-end-to-end-design.md`

## Files Modified

- `src/gapmap/core/db.py` — `source_credentials.enabled` column + migration.
- `src/gapmap/core/credentials.py` — `enabled` in get/set, `is_enabled`/`set_enabled`.
- `src/gapmap/research/reach_connections.py` — catalogue, `login_pair`, live checks,
  `toggle_connection`, `connected_collection_sources`.
- `src/gapmap/research/collect.py` — auto-include connected social sources.
- `src/gapmap/sources/_scrapecreators.py`, `truthsocial.py`, `bluesky.py` — read store first.
- `src/gapmap/cli/main.py` — `creds toggle`.
- `app-tauri/src-tauri/src/commands.rs`, `main.rs` — `creds_toggle` command.
- `app-tauri/src/or/api.js` — `credsToggle` wrapper.
- `app-tauri/src/or/dynamic.js` — `renderConnections` cards, toggle, pills, unlocks.

## Follow-up

- **Prod sidecar rebuild required** before a DMG release so the new `creds`/adapter
  behavior ships (dev `.venv` picks it up immediately). See Phase 9 of the
  `tauri-python-sidecar-app` skill.
- User to add a ScrapeCreators API key (100 free credits) to light up TikTok/Instagram/
  Threads/Pinterest.
