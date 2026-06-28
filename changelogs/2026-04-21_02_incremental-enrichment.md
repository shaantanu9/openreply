# Incremental enrichment — two-phase pipeline

**Date:** 2026-04-21
**Type:** Feature / Infrastructure

## Summary

Turns OpenReply from "start a collect → wait 10 minutes → see findings" into "collect freely → at 100 posts a background worker starts extracting in small batches → every open screen refreshes in real time."

Phase A: collect warmup. Sources run as today, a progress card shows live post count + source chips + ETA. No LLM spin until the threshold crosses. Flat ~150 MB.

Phase B: incremental enrichment. A long-lived Python worker drains an `extraction_queue` in batches of 5, emits NDJSON events over stdout (Rust supervisor re-emits as Tauri events), and every screen reacts via the existing `mutated('findings')` pipeline. Memory-governed (RSS ≤ 600 MB, drops ChromaDB on idle, Ollama keep_alive=0 toggle) so it survives 8-hour sessions.

User-facing controls in Settings → Extraction: mode radio (auto/manual/scheduled), post threshold slider (50-500), batch-size slider (1-20), daily token cap, "Release LLM when idle" toggle, live cost estimator. Per-topic overrides via popover on the topic page.

Also ships a saturation score v1 (new clusters per last-50 posts) and a coverage-gaps panel that proposes missing source adapters and fires a scoped re-collect on click.

## Architecture shift

- **Before:** one big `collect` → one big `enrich_from_llm(topic=...)` inline → one big graph build. Tabs empty until the pipeline finishes.
- **After:** collect tags posts → enqueues rows → worker drains continuously → graph grows row-by-row. Every mutation event means every open screen auto-refreshes.

## Commits (in order)

- `2bc902a` — extraction_queue table + backfill on schema init
- `e719a63` — auto-enqueue on collect + opt-out inline extraction
- `f509f8f` — long-lived Python worker with sleep ladder + memory governor
- `a8554bb` — per-post extractor + palace idle-evict + ollama keep-alive=0 toggle
- `e2b777e` — Rust supervisor + active-topic tracking + NDJSON event bridge
- `29dcb24` — auto-start worker when any topic crosses 100 posts
- `bb5ed7c` — Phase-A collect progress card + threshold flip animation
- `6eee478` — saturation v1 + coverage gaps panel
- `1125157` — reactive wiring + freshness badges + error banner
- `0047c2e` — Settings extraction pane + per-topic overrides + daily token cap + scheduled windows
- `d5ac5c4` — spec + plan
- `3f6fa57` — plan §9.5 (token-cost controls)

## Files Created

- `src/reddit_research/research/enrich_worker.py`
- `src/reddit_research/research/saturation.py`
- `src/reddit_research/research/coverage.py`
- `app-tauri/src-tauri/src/worker.rs`
- `app-tauri/src/lib/enrichStatus.js`
- `tests/test_enrich_worker.py`
- `docs/superpowers/specs/2026-04-21-incremental-enrichment-design.md`
- `docs/superpowers/plans/2026-04-21-incremental-enrichment.md`
- `changelogs/2026-04-21_02_incremental-enrichment.md`

## Files Modified

- `src/reddit_research/core/db.py` — `extraction_queue`, `extraction_daily_usage`, `topic_prefs` ALTER columns
- `src/reddit_research/research/collect.py` — `skip_extraction` flag + auto-enqueue
- `src/reddit_research/cli/main.py` — `research enrich-worker --serve`, `research saturation`, `research coverage-gaps`
- `src/reddit_research/graph/semantic.py` — `enrich_from_llm_for_posts` scoped extractor + token usage write
- `src/reddit_research/retrieval/palace.py` — `_drop_client_if_any` + idle-drop
- `src/reddit_research/analyze/providers/ollama.py` — `OPENREPLY_RELEASE_LLM_IDLE` opt-in
- `app-tauri/src-tauri/src/commands.rs` — 5 worker commands + 3 prefs commands + `topic_saturation` + `topic_coverage_gaps`
- `app-tauri/src-tauri/src/main.rs` — `.setup()` boot gate, generate_handler registrations, `stop_worker_blocking` on exit
- `app-tauri/src/api.js` — worker controls + prefs CRUD + saturation/coverage readers
- `app-tauri/src/main.js` — Tauri→DOM event bridge, cap-reached + error banners
- `app-tauri/src/screens/collect.js` — Phase-A card with threshold flip
- `app-tauri/src/screens/topic.js` — saturation badge header + coverage panel + override row + freshness badges
- `app-tauri/src/screens/settings.js` — extraction pane with 5 controls + cost estimator + today's spend
- `app-tauri/src/style.css` — phase card + saturation + coverage + freshness styles

## Memory budget

Under 8 GB Mac with the app + Slack + browser open. Peak ≤ 5 GB during active collect + extraction + Ollama.

- Rust shell: ~80-120 MB
- Native SQLite reads: ~5 MB/query
- Python collect sidecar: 90-250 MB (dies when done)
- Python extraction worker: 120-450 MB (long-lived, capped at 600 MB → OOM-restart)
- Ollama (optional): 3-4 GB (auto-unload opt-in)
- ChromaDB palace: ~200 MB when querying, evicted after 5 min idle

## Next (not shipped in v1)

- Parallel per-topic workers (queue semantics already support it; just needs Rust supervision)
- Full embedding-novelty saturation math (currently: new-clusters-per-50 ratio)
- Real-vendor token counts (currently: char/4 estimate; provider interface needs extension)
- `paused_until` consumption in the worker (banner writes it but worker doesn't yet read it)

Skill published at `~/.claude/skills/desktop-incremental-enrichment/SKILL.md` — battle-tested patterns reusable in any Tauri + Python desktop research app.
