# Extraction Settings pane + per-topic overrides + daily token cap

**Date:** 2026-04-21
**Type:** Feature

## Summary

Task 9.5 of the incremental-enrichment plan. Adds user-facing controls for
the Python extraction worker: global Settings → Extraction card, per-topic
override row above the topic tabs, daily token-cap banner, and token-usage
tracking per provider/model. Backs a 3-tier pref resolution (topic row →
`extraction.json` → hardcoded defaults) that the worker honors before each
batch.

## Changes

- DB: new `extraction_daily_usage(day, provider, model, tokens_in,
  tokens_out, est_usd)` table; additive ALTERs on `topic_prefs` for
  `extraction_mode/threshold/batch_size/window_start/window_end/
  daily_token_cap/release_llm_idle` (all nullable — CLI back-compat).
- Worker: `_load_prefs(topic)` reads 3-tier prefs; `_filter_rows_by_prefs`
  drops manual-mode topics, out-of-window scheduled topics, and topics
  that have exhausted their daily token cap. Emits `enrich:cap-reached`
  once per topic per day.
- Token counter: `_run_extractor_on_rows` records char-estimated
  tokens via `_record_token_usage`. Pricing table for
  anthropic/openai/openrouter/groq/deepseek/google/ollama; unknown pairs
  default to (0, 0).
- Rust: three new commands — `extraction_prefs_get(topic?)`,
  `extraction_prefs_set(scope, prefs)`, `today_token_spend()` — all using
  native rusqlite. Atomic `extraction.json` writes via `.tmp` + rename.
- JS: `api.extractionPrefsGet/Set/todayTokenSpend` with cache + invalidation
  via `mutated('extraction_prefs')`.
- Settings: new Extraction card with mode radios (auto/manual/scheduled +
  time pickers), threshold slider 50–500, batch-size slider 1–20, daily
  cap input with enable checkbox, "Release LLM when idle" toggle, and a
  live cost estimator ("N posts × 350 tokens/batch ≈ $X via Provider").
- Topic page: compact override row above tabs — "This topic uses: Auto ·
  100 posts · batch 5 · [Override]". Override opens an inline popover with
  mode/threshold/batch sliders; Reset clears the override.
- Main: red `enrich-cap-topbar` banner on `openreply:enrich-cap` with "Raise
  cap" (→ Settings) and "Pause until tomorrow" (writes `paused_until` to
  `extraction.json`).

## Files Modified

- `src/reddit_research/core/db.py` — `_ensure_extraction_prefs_schema` +
  wire into `init_schema`.
- `src/reddit_research/research/enrich_worker.py` — prefs reader, window
  check, cap check, `_filter_rows_by_prefs` in drain loop.
- `src/reddit_research/graph/semantic.py` — `_PROVIDER_PRICING`,
  `_record_token_usage`, `_estimate_tokens`, usage-record call in
  `_run_extractor_on_rows`.
- `app-tauri/src-tauri/src/commands.rs` — `extraction_prefs_get/set` +
  `today_token_spend` + helpers (`read/write_global_prefs`,
  `read/write_topic_prefs_row`, pricing defaults, `local_today_iso`,
  Howard-Hinnant `days_to_ymd`).
- `app-tauri/src-tauri/src/main.rs` — register the three new commands.
- `app-tauri/src/api.js` — `extractionPrefsGet/Set/todayTokenSpend` +
  INVALIDATE_MAP entry.
- `app-tauri/src/screens/settings.js` — `fillExtractionCard` UI + cost
  estimator + mode/threshold/batch/cap/idle-release controls.
- `app-tauri/src/screens/topic.js` — `_renderExtractionOverrideRow` + inline
  popover.
- `app-tauri/src/main.js` — `openreply:enrich-cap` banner with Raise/Pause CTAs.

## Notes / Stubs

- Token accounting uses char-count estimation (`len // 4`) since the
  `LLMProvider.complete()` surface returns a bare string. Vendor usage
  objects will be wired through in a follow-up; the data_usage table
  schema already accepts exact counts.
- Scheduled window parsing is simple HH:MM lexical compare with overnight
  support (23:00–06:00). No timezone plumbing — uses local system clock.
- "Paused until tomorrow" writes `paused_until` to `extraction.json` but
  the worker currently reads only the 3-tier prefs; the paused_until flag
  is UI-only until the worker consumes it (follow-up).
