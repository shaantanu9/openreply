# User-added custom RSS feeds (add any feed → swept on every collect)

**Date:** 2026-06-05
**Type:** Feature

## Summary

Users can now add their own RSS/Atom feed URLs in **Settings → Custom RSS
feeds**. Each feed is validated on add (scheme/SSRF guard → fetch → parse,
rejecting non-feeds and Cloudflare-walled review sites), stored in the shared
`gapmap.db`, and swept on **every collect** via a new `rss_user` source —
topic-keyword filtered like every other RSS source, and relevance-gated like all
sources. Rows are tagged `rss:user:<feed name>` so a user's own feed is
identifiable in the corpus.

## Design

The fetch engine already supported arbitrary feeds (`run_rss(urls=…)`), but
nothing passed user URLs or persisted them. Added:

- **Storage** — `user_feeds(url PK, name, enabled, added_at)` table in the
  shared DB (Python sidecar + desktop UI both reach it).
- **Source** — `run_rss_user` reads enabled feeds and routes them through
  `run_rss` under an empty `"user"` sentinel category (so only the user's feeds
  are fetched, not the curated bundle). Registered as `rss_user` in `SOURCES`
  and added to the aggressive + baseline collect defaults.
- **Validation** — `sources/rss.validate_feed()` + `_is_safe_feed_url()`
  (http(s) only; blocks localhost / private / link-local / reserved IPs).
- **CLI** — `feeds list|validate|add|remove|enable` Typer subcommands.
- **Tauri triangle** — `feeds_list/validate/add/remove/enable` commands
  (commands.rs) + `generate_handler!` registration (main.rs) + `api.feeds*`
  (api.js).
- **UI** — a "Custom RSS feeds" Settings card (input + Test&Add + per-feed
  pause/remove) and an `rss_user` collect-progress chip ("RSS — My feeds").

## Issues handled

- Non-feed / bad URL → rejected ("no items found").
- Cloudflare-walled review site (G2/Capterra/AlternativeTo reviews) → rejected
  with a clear 403 message.
- SSRF — only http(s) to public hosts; internal/loopback IPs blocked.
- Duplicates → URL primary key (upsert).
- Empty feed list / disabled feeds → `run_rss_user` returns 0 gracefully.
- Dead feed later → `run_rss` already degrades to 0 on failure.

## Verification

- Python end-to-end (temp DB): validate good (G2 RSS, 50 items) / blocked
  (g2.com reviews 403) / SSRF (localhost) / not-a-feed; add→list→run_rss_user
  persists 20 rows tagged `rss:user:G2`; disable→0; remove.
- `cargo check` → 0 errors. `node --check` on settings.js / api.js / collect.js
  → clean. Python `ast.parse` on all 6 modules → OK.

## Files Modified

- `src/gapmap/core/db.py` — user_feeds table + list/add/remove/set_enabled.
- `src/gapmap/sources/rss.py` — `validate_feed` + `_is_safe_feed_url`.
- `src/gapmap/sources/collect_adapter.py` — `run_rss_user`, `rss_user` source,
  `url_names` tagging in `run_rss`.
- `src/gapmap/sources/rss_catalog.py` — empty `user` sentinel category.
- `src/gapmap/research/collect.py` — `rss_user` in collect defaults.
- `src/gapmap/cli/main.py` — `feeds` Typer sub-app.
- `app-tauri/src-tauri/src/commands.rs` — 5 `feeds_*` Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — handler registration.
- `app-tauri/src/api.js` — `feeds*` bridge methods.
- `app-tauri/src/screens/settings.js` — Custom RSS feeds card + loader.
- `app-tauri/src/screens/collect.js` — `rss_user` chip + AGGRESSIVE_SOURCES.
- `app-tauri/src/style.css` — `#card-rss-feeds` order.

## Follow-up

Shipped DMG needs a sidecar rebuild to expose the new `feeds` CLI + `rss_user`
source (Phase 9). Works in `npm run tauri:dev` now (dev venv + Rust recompile).
