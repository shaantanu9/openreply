# Streaming enrich with single-source + parallel options

**Date:** 2026-04-24
**Type:** Feature + UX fix

## Summary

The Map tab banner "Extracting painpoints in the background via LLM — the map will refresh when findings are ready (20–90s)" routinely sat for 2–6 minutes with no output, because `enrich_graph` ran all four extractors (painpoints / feature_wishes / product_complaints / diy_workarounds) sequentially over 120 posts and only returned after the fourth LLM call finished. With Ollama the sampler-queued calls piled up and the user saw a spinner with no signal of progress — sometimes exceeding the 10-minute dedup-stale timer and looking broken.

This ships a streaming enrich path so the UI sees per-extractor events the moment each one completes, shows sample finding titles inline (e.g. "5 painpoints · lost keys, insomnia, forgetting names…"), and lets the user pick a single category (fastest) or fan cloud providers out in parallel.

## Changes

- **Python `graph enrich` CLI** — added `--stream`, `--only painpoints|features|complaints|workarounds`, and `--parallel` flags. In stream mode it emits NDJSON events (`enrich:start`, `extractor:start`, `extractor:done`, `extractor:error`, `enrich:done`) to stdout so a supervisor can forward them.
- **Python `find_gaps` / `enrich_from_llm`** — accept `only`, `parallel`, `progress_cb`. Parallel skips Ollama (single-queue LLM, fan-out thrashes CPU/RAM). `progress_cb` is invoked at lifecycle boundaries.
- **Rust `enrich_graph_stream` command** — spawns the sidecar, forwards stdout lines as `enrich:progress` Tauri events, emits `enrich:stream:done` on exit. Reuses per-topic dedup via `ActiveGraphOps` with the same `enrich:<topic>` key space as the blocking command, and auto-unlistens its cleanup handler after the first fire to avoid listener leaks.
- **Rust `ActiveEnrich` / `ActiveEnrichPid` state slots** — separate from `ActiveJob`/`ActiveStream` so a stream-mode enrich does not collide with an in-progress collect or chat session.
- **`run_cli_enrich_streaming` helper in `cli.rs`** — mirrors `run_cli_streaming` with its own pid slot, no cross-call exclusion (dedup is per-topic, not per-global).
- **Frontend `runEnrichStreamForTopic(topic, {only, parallel, onComplete})` in `topic.js`** — subscribes to `enrich:progress` + `enrich:stream:done`, updates banner status per-extractor, renders up-to-12 sample finding titles as pill chips. Auto-unregisters listeners on done.
- **Map banner redesign** — vertical stack with progress row + sample chips + action row (category picker + Run button). Empty-0-findings path now offers "Retry painpoints only" which kicks a single-extractor stream (30–90s) instead of re-running all four.
- **Honest copy** — removed the "(20–90s)" promise which lied on local models; the banner now shows live provider + corpus size + current extractor.
- **`api.enrichGraphStream(topic, {only, parallel})`** bridge in `api.js`.

## Files Created

- `changelogs/2026-04-24_19_enrich-streaming-progress-and-single-source.md`

## Files Modified

- `src/reddit_research/research/gaps.py` — `_EXTRACTORS` tuple, `_normalize_only`, `find_gaps(only, parallel, progress_cb)` with optional `ThreadPoolExecutor` fan-out.
- `src/reddit_research/graph/semantic.py` — `enrich_from_llm` passes the new kwargs through to `find_gaps`.
- `src/reddit_research/cli/main.py` — `cmd_graph_enrich` adds `--only` / `--parallel` / `--stream`; stream mode emits NDJSON events per extractor and a final `enrich:done` with the consolidated summary.
- `app-tauri/src-tauri/src/cli.rs` — `ActiveEnrich`, `ActiveEnrichPid` state types; `run_cli_enrich_streaming` helper.
- `app-tauri/src-tauri/src/commands.rs` — `enrich_graph_stream` Tauri command; stale-lock check + dedup via `ActiveGraphOps`; self-unlistening cleanup handler.
- `app-tauri/src-tauri/src/main.rs` — registers the new state slots and command in `invoke_handler`.
- `app-tauri/src/api.js` — `enrichGraphStream(topic, opts)` wrapper.
- `app-tauri/src/screens/topic.js` — module-level `runEnrichStreamForTopic` helper; map auto-enrich swapped from blocking to streaming; toolbar wiring for the new banner Run button + category picker.
- `app-tauri/src/style.css` — banner flex column layout, sample-chip styles, action row.
