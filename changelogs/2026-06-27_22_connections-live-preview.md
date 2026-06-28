# Connections "Test reach" — live content preview modal

**Date:** 2026-06-27
**Type:** Feature

## Summary

"Test reach" / Verify only showed a count ("OK — 3 rows"). Now it **live-fetches a
sample of the actual content** from the source and shows it in a modal — titles as
clickable links, author, score, comment count, and a snippet — so you can confirm
Reddit and every other data source is genuinely working and inspect what it returns.
Fetch mechanics follow the `fintech_repos/last30days-skill` model (keyless Reddit
cascade, HN/Algolia, ScrapeCreators socials, Bluesky AT-proto, etc.).

## Changes

- **Backend** (`research/reach_connections.py`):
  - Refactored the source fetchers into a shared `_fetch_rows(source, query, limit)`
    (used by both verify and preview; never raises, filters error rows).
  - New `preview_source(source, query=None, limit=6)` → `{ok, count, message, query,
    items:[{title, url, author, score, comments, source_type, snippet}], unlocks}`.
    A successful credentialed preview also stamps `last_verified_at` (proves the
    credential). LinkedIn returns a clear "URL-reader only" note.
- **CLI**: `openreply creds preview --source X [--query Q] [--limit N] --json`.
- **Rust**: `creds_preview(source, query, limit)` (+ `main.rs` registration).
- **JS**: `api.credsPreview(source, query, limit)`.
- **UI** (`renderConnections`): every public + connected card gets a **👁 Test reach**
  button (public cards keep a secondary "Check status"); it opens a modal listing the
  live items with clickable links, or a clear "connect/verify first / rate-limited"
  message when empty. Applies to Reddit, X, the ScrapeCreators quartet, Bluesky,
  TruthSocial, Mastodon, YouTube, HN, Dev.to, Bilibili, Xueqiu, Xiaohongshu.

## Verification

- `reach_connections.py` + `main.py` parse; `vite build` passes (282 KB).
- Live CLI preview smoke on keyless sources (hackernews / reddit / dev.to) returns real
  titles + URLs.
- `cargo check` for `creds_preview`.

## Files Modified

- `src/openreply/research/reach_connections.py`, `src/openreply/cli/main.py`,
  `app-tauri/src-tauri/src/commands.rs` + `main.rs`, `app-tauri/src/or/api.js`,
  `app-tauri/src/or/dynamic.js`.
