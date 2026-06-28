# Social Media Fetch — Properly Working, End-to-End

**Date:** 2026-06-27
**Status:** Approved — implementing
**Scope:** Make every social source actually fetch real posts from the app, via the Connections UI, with credential management + verify + "use in collection" toggles.

## Problem

The social adapters (`x`, `tiktok`, `instagram`, `threads`, `pinterest`, `bluesky`,
`truthsocial`, `youtube`, `mastodon`, `bilibili`, `xiaohongshu`, `linkedin`) are
**already implemented** in `src/openreply/sources/`. They don't feel "working" because:

1. **None are in the default collection pipeline** (`research/collect.py` defaults
   exclude all social) — they only run on an explicit `--sources` flag, so the app
   never triggers them.
2. **ScrapeCreators key (the unlock for tiktok/instagram/threads/pinterest) is read
   only from `SCRAPECREATORS_API_KEY` env** — `_scrapecreators.api_key()` never checks
   the credential store, so a key pasted in the UI never reaches the fetcher.
   Same for `truthsocial` (`TRUTHSOCIAL_TOKEN`) and `bluesky` (`BSKY_*`).
3. **Connections catalogue (`reach_connections.GATED`) is missing** `scrapecreators`,
   `truthsocial`, `youtube`, and mis-classifies `bluesky` as `public` (it needs a
   handle + app-password or it 403s → silent empty).
4. **No "use in collection" control** — connecting a source doesn't make it run.

## Design (4 changes, no new scrapers)

### 1. Adapters read the credential store first, env fallback
- `sources/_scrapecreators.py::api_key()` → `credentials.api_key("scrapecreators")` → env.
  *Unlocks tiktok + instagram + threads + pinterest at once.*
- `sources/truthsocial.py::_token()` → `credentials.api_key("truthsocial")` → env.
- `sources/bluesky.py::_session()` → store `{handle, app_password}` → env.

### 2. Connections catalogue + new `login_pair` kind (`reach_connections.py`)
- Add `scrapecreators` (api_key, `unlocks: tiktok/instagram/threads/pinterest`),
  `truthsocial` (api_key/token), `youtube` (public/keyless).
- Change `bluesky` → `login_pair` kind (two fields: handle + app-password).
- `_live_check` probes for each; `save_manual` parses `login_pair`.
- `list_connections` gains `enabled` + `unlocks` fields.
- `toggle_connection(source, enabled)` persists the "use in collection" flag.
- `connected_collection_sources()` maps connected+enabled connections → CLI source
  names (`twitter→x`, `scrapecreators→[tiktok,instagram,threads,pinterest]`, etc.).

### 3. Collection auto-includes connected social sources (`collect.py`)
- After the default `sources` list is computed (and only when the caller didn't pass
  `--sources` explicitly), append `connected_collection_sources()` (deduped).
  Mental model: **connect = enabled**; nothing paid runs until you connect.

### 4. Persistence + CLI + Rust + UI
- `db.py` `source_credentials` gains an `enabled INTEGER DEFAULT 1` column (ALTER migration).
- `credentials.py` `is_enabled()` / `set_enabled()` helpers; `set_credential` defaults enabled=1.
- `cli/main.py` `creds toggle --source X --enabled/--disabled`.
- `commands.rs` + `main.rs` `creds_toggle` (run_cli wrapper) + register.
- `or/api.js` `credsToggle()`.
- `or/dynamic.js::renderConnections` — `login_pair` two-field card, per-card "Use in
  collection" toggle, status pills (Connected / Needs key / Unreachable), `unlocks` note.

### 5. Docs ("learn the content + post fetching")
- `docs/SOCIAL_FETCH.md` — per-platform mechanism / credential / endpoint / returns /
  cost / normalize-into-`posts` flow.

## Out of scope (future)
- Per-platform sub-toggles inside the one ScrapeCreators key (card toggle covers all 4).
- OS-keychain hardening of `source_credentials`.
- LinkedIn topic-search (stays URL-only).

## Verify
- `openreply creds verify --source <s>` returns real counts.
- Connect → verify → collect → rows land in `posts`.
- Prod: sidecar rebuild + re-codesign before DMG.
