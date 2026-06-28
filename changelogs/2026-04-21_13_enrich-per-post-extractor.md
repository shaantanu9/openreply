# Per-post Extractor + Palace Idle-Evict + Ollama keep-alive=0

**Date:** 2026-04-21
**Type:** Feature

## Summary

Task 4 of the incremental-enrichment plan. Ships `enrich_from_llm_for_posts(topic, post_ids)` — a scoped variant of `enrich_from_llm` that extracts findings from a 5-post batch instead of the whole topic corpus. Adds a lazy 5-minute ChromaDB idle evictor to `palace.py` and an opt-in `keep_alive=0` signal to the Ollama provider, both to keep the extraction worker's long-lived RSS footprint predictable.

## Changes

- **`graph/semantic.py`**: new `enrich_from_llm_for_posts(topic, post_ids, provider=None) -> (n_findings, tokens_in, tokens_out)`. Pulls `posts WHERE id IN (post_ids)` joined through `topic_posts`, runs the 4 extractors (painpoints / features / complaints / diy) against that scoped corpus, then persists via `upsert_semantic`. Stamps `evidence_post_id` on every freshly-written semantic node so the Task 1 backfill query can tell which posts have been extracted. Token accounting returns `(n_findings, 0, 0)` until the provider `complete()` interface exposes usage metadata (tracked for Task 9.5).
- **`graph/semantic.py`**: added helpers `_corpus_rows_for_posts`, `_run_extractor_on_rows`, `_stamp_evidence_post_ids`. Keeps the whole-topic `enrich_from_llm` signature + semantics untouched — no regression risk.
- **`core/db.py`**: added nullable `evidence_post_id TEXT` column on `graph_nodes` (create-path + ALTER migration for existing installs) with an index. This is the column Task 1's `_ensure_extraction_queue` backfill LEFT-JOINs on to decide which topic_posts still need extraction.
- **`retrieval/palace.py`**: added `_drop_client_if_any()` — walks every entry in `_CLIENT_CACHE`, calls `chromadb.api.client.SharedSystemClient.clear_system_cache()` if available, resets the cache dict. Called by the enrich_worker's memory governor. Added `_maybe_evict_idle()` + `_bump_embed_ts()` — a lazy 5-min idle evictor that runs at the top of every `get_palace()` call and stamps the timer after each embed/search/upsert. No background timer thread needed.
- **`analyze/providers/ollama.py`**: added opt-in idle release. When `OPENREPLY_RELEASE_LLM_IDLE=1/true/yes/on` AND the last call was >10 minutes ago, the next generate request sends `keep_alive: 0` so Ollama unloads the model on completion. Default behaviour (Ollama's 5-min keep-alive) is preserved when the toggle is off.

## Files Created

- `changelogs/2026-04-21_13_enrich-per-post-extractor.md` (this file)

## Files Modified

- `src/reddit_research/graph/semantic.py` — new per-post extractor + helpers
- `src/reddit_research/core/db.py` — `evidence_post_id` column on `graph_nodes`
- `src/reddit_research/retrieval/palace.py` — `_drop_client_if_any`, `_maybe_evict_idle`, `_bump_embed_ts`
- `src/reddit_research/analyze/providers/ollama.py` — opt-in `keep_alive: 0` on idle

## Verification

- `pytest tests/` — 69 passed, 2 pre-existing failures (Ollama ping + discover_subs, both network-dependent, unrelated to this change).
- `test_schema_creates_queue`, `test_tag_posts_enqueues`, `test_drain_batch_removes_on_success` all green — enrich_worker still drains its queue via the new function via the import shim.
- Import smoke: empty post_ids → `(0, 0, 0)`; non-existent post_ids → `(0, 0, 0)` without LLM call.
- `evidence_post_id` column present on fresh DB init.
