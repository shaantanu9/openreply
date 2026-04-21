# One-command dev launcher — `./scripts/dev.sh` + sidecar doctor

**Date:** 2026-04-20
**Type:** Infrastructure

## Summary

Every fresh clone / new machine / post-pull restart hit the same four things in sequence: venv exists?, extras installed?, any stale tauri/gapmap/vite on port 1420?, sidecar imports clean?. Running them by hand every time ate minutes. This bundle collapses all of it behind one script, with a pre-launch doctor that exits non-zero if the sidecar can't start so the Tauri window never opens on a broken backend.

## Changes

### `scripts/dev.sh` (new)

Subcommands:

| cmd | effect |
|---|---|
| `./scripts/dev.sh` (default `dev`) | preflight → kill stray → install deps (if missing) → doctor → `npm run tauri dev` |
| `./scripts/dev.sh setup` | install deps + run doctor, don't launch |
| `./scripts/dev.sh doctor` | sidecar health check only |
| `./scripts/dev.sh kill` | stop running tauri/gapmap/vite/esbuild + free port 1420 |
| `./scripts/dev.sh clean` | kill + remove `target/debug/build`, `app-tauri/dist/` |
| `./scripts/dev.sh reset-db` | wipe the Tauri app's SQLite DB at `~/Library/Application Support/com.shantanu.gapmap/reddit-myind/` — asks for `YES` confirmation |

Preflight specifics:
- Prefers `.venv/bin/python` when the venv exists (real 3.12+), falls back to `python3.13/3.12/3.11` hunt if venv needs bootstrapping. Refuses to proceed on system `python3` if it's <3.11 (pyproject requires 3.11+).
- Sets `REDDIT_MYIND_DEV_PYTHON` to `.venv/bin/python` so `src-tauri/src/cli.rs::find_dev_venv_python` uses the dev interpreter instead of the bundled PyInstaller binary — matches the macOS Gatekeeper bypass pattern in the `tauri-python-sidecar-app` skill.
- Kill pass uses SIGTERM first, then SIGKILL for anything still alive, then `lsof -ti :1420` to free Vite's port if an orphan is squatting.
- `--quiet` pip install; skipped entirely if `reddit_research + feedparser + pypdf + google_play_scraper + pytrends + networkx` already import. Makes re-runs instant.

### `scripts/doctor.py` (new)

Pre-launch sidecar health check. Sections:

1. **Core imports** — 15 modules the Tauri sidecar will touch on first `run_cli`. Flags any ImportError before the user clicks "Collect" and gets a 30 s JSON parse failure.
2. **Optional extras** — feedparser, pypdf, google_play_scraper, pytrends, networkx. Missing = warning (not blocking).
3. **SOURCES registry** — asserts every id the UI picker dispatches (16 core sources + 12 RSS bundle entries) is present in `SOURCES` dict. Catches typos like the wizard passing `rss_tech` when the Python side is `rss_tech_news`.
4. **Database schema** — creates a tempdir DB, runs `init_schema`, asserts every table the UI queries exists (posts, topic_posts, graph_nodes, fetches, topic_runs, topic_prefs, paper_analyses, topic_insights, topic_canonicalizations, trend_series, streams, stream_hits, hypothesis_tests, subreddits, users, comments). First version had the wrong assumed names (topics/fetch_log/llm_cache) — those were adapted to match what `init_schema` actually creates.
5. **LLM provider resolution** — calls `resolve_provider()` and reports which provider the sidecar will use (openai / anthropic / openrouter / ollama / …). Non-blocking — no provider = valid BYOK config state.

Exit codes: 0 healthy / 1 critical (blocks launch) / 2 warnings only.

## Issues caught while building the doctor

| Assumption (first pass) | Reality | Fix |
|---|---|---|
| `init_schema` creates `topics` table | only `topic_posts` / `topic_runs` / `topic_prefs` exist; "topic" is an FK string | doctor's required-tables list now matches actual schema |
| `init_schema` creates `fetch_log`, `analysis_log`, `llm_cache` | real names are `fetches`, `topic_runs`, and LLM output persists in `graph_nodes` (per 2026-04-20 persistence changelog) | doctor list updated |
| `resolve_provider()` returns `(name, info)` tuple | returns bare `str` | doctor unpacks a string now |
| script used `GAPMAP_DEV_PYTHON` env var | `cli.rs` reads `REDDIT_MYIND_DEV_PYTHON` | renamed in `dev.sh::launch` |

## Verification

- `./scripts/dev.sh doctor` → all ✓, sidecar healthy, exit 0.
- `./scripts/dev.sh setup` → idempotent (re-runs report "already installed" instantly).
- `./scripts/dev.sh kill` on a fresh shell → "nothing was running" (no false positive).
- `./scripts/dev.sh` launched end-to-end → Vite up on :1420, cargo built, `target/debug/gapmap` process live, sidecar serving queries (logged `dev-python OK in NNms` on multiple Tauri invocations).

## Files Created

- `scripts/dev.sh`
- `scripts/doctor.py`
