# Startup health check + PyInstaller lazy-import fix

**Date:** 2026-04-20
**Type:** Infrastructure

## Summary

Shipped a single-file DMG to another Mac — user hit a blank page when fetching. Root cause cascade:

1. `reddit-cli.spec` only ran `collect_all('reddit_research')`, which missed source adapters that are **lazy-imported** inside functions (`google_play_scraper`, `pytrends`, `feedparser`, `lxml`, `pypdf`, `pandas`, `scipy`, `networkx`, `sgmllib3k`). PyInstaller's static analysis never saw them, so the bundled binary crashed at runtime the moment Play Store / App Store / RSS fetch ran — silently, because Rust swallows non-zero exit into an `error_class` string.
2. The app had **no startup diagnostics**. Users on a fresh install couldn't tell whether the sidecar launched, the DB schema was created, the ONNX model was cached, or an LLM was reachable. A silent sidecar failure looked identical to "app is loading" and ended in a blank page once the collect died.

Fix: (a) added `collect_all` for all nine lazy-imported source deps to `reddit-cli.spec`, (b) added `reddit-cli health --json` + Rust `health_check` command + welcome Step 3 auto-run + boot-time blocker banner so every launch self-diagnoses.

## Changes

- `reddit-cli.spec` — added loop collecting google_play_scraper / pytrends / feedparser / lxml / pypdf / pandas / scipy / networkx / sgmllib3k via `collect_all`
- `src/reddit_research/cli/main.py` — new `health` Typer subcommand returning structured JSON with per-check ms timings: data_dir writable, DB schema (14 expected tables), palace ONNX model, LLM provider resolvable, Reddit OAuth status
- `app-tauri/src-tauri/src/commands.rs` — new `health_check` Rust command that wraps the sidecar call with a spawn-probe so frontend can distinguish "sidecar can't launch" from "sidecar ran but checks failed"
- `app-tauri/src-tauri/src/main.rs` — registered `health_check` in the invoke handler
- `app-tauri/src/lib/healthCheck.js` — new module: `runHealthCheck()`, `renderHealthCard(host, payload, opts)`, `healthIsBlocking(payload)`. Normalizes the payload shape across "sidecar never spawned" vs "sidecar returned JSON with failing checks"
- `app-tauri/src/main.js` — on every DOMContentLoaded, runs a silent health probe; if a blocker is found, injects a red `.hc-topbar` banner at the top of the page with a "Run setup check" button that jumps to Welcome Step 3
- `app-tauri/src/screens/welcome.js` — Step 3 now auto-renders a health card above the provider chips with per-check pass/fail rows and a Re-run button
- `app-tauri/src/style.css` — `.hc-card`, `.hc-row`, `.hc-dot`, `.hc-topbar` styles
- `app-tauri/src/api.js` — `api.healthCheck()` (intentionally uncached — always fresh)

## Also confirmed: single DB, single owner

While auditing for this fix, confirmed the Rust↔Python DB wiring is correct:

- Rust `cli.rs:data_dir()` resolves `~/Library/Application Support/com.shantanu.gapmap/reddit-myind/` and passes `REDDIT_MYIND_DATA_DIR=<that path>` on **every** sidecar spawn
- Python `core/config.py:75` reads that env; `db_path = data_dir / "reddit.db"`
- Rust **never opens the DB directly** — only `std::fs::metadata()` for the mtime poller
- All UI queries: Rust dispatcher → Python sidecar → SQLite → JSON → back up
- WAL mode on, so concurrent reads during an active collect don't block

Single DB, single owner. No race conditions possible.

## Files Created

- `changelogs/2026-04-20_06_startup-health-check-and-bundled-deps.md`
- `app-tauri/src/lib/healthCheck.js`

## Files Modified

- `reddit-cli.spec` — added 9-package `collect_all` loop for lazy-imported source adapters
- `src/reddit_research/cli/main.py` — `cmd_health` Typer subcommand
- `app-tauri/src-tauri/src/commands.rs` — `health_check` Rust command
- `app-tauri/src-tauri/src/main.rs` — registered command in invoke_handler
- `app-tauri/src/main.js` — boot-time health probe + red topbar for blockers
- `app-tauri/src/screens/welcome.js` — Step 3 health card with auto-run + re-run button
- `app-tauri/src/api.js` — `healthCheck` uncached invoke
- `app-tauri/src/style.css` — health-card + topbar CSS
