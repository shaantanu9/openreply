# Fix Ollama: timeout, JSON-output mode, dual-DB diagnosis

**Date:** 2026-04-19
**Type:** Fix / Investigation

## Summary

User switched their default LLM to Ollama (`llama3.2:3b`) and asked OpenReply to re-analyze the existing `calari tracking app` topic (13K nodes, 5 painpoints from the old provider). Running the enrichment surfaced **three distinct issues** that were silently burning analyses:

1. **Ollama HTTP timeout was 120s** hardcoded in `OllamaProvider.complete` — enough for GPU-backed models but not for CPU-only small models like `llama3.2:3b` on a 120-post prompt. Every extractor call hit the ceiling exactly at 120.00s and raised `enrich failed: timed out`. Fixed: bumped to 600s, overridable via `OLLAMA_TIMEOUT` env var.

2. **Small Ollama models truncated mid-JSON** — `num_predict=2048` wasn't enough for a 120-post corpus prompt, so llama3.2:3b wrote half an array and stopped. `_parse_json` returned `{"_raw": …, "_parse_error": True}`. `enrich_from_llm`'s `isinstance(..., list)` guard dropped the dict as `[]`, producing a clean `{"ok": true, "painpoints_added": 0}` success that was actually total loss. Fixed: add `"format": "json"` to the Ollama `/api/generate` payload whenever the system prompt mentions JSON. Ollama constrains the grammar to valid JSON output so truncation still produces syntactically-closed arrays.

3. **Dev CLI was reading the wrong database.** The Tauri app stores data under `~/Library/Application Support/com.shantanu.openreply/reddit-myind/reddit.db`, but `reddit-cli info` without `REDDIT_MYIND_DATA_DIR` set resolves to the repo-local `./data/reddit.db`. When the user ran the CLI to poke at their 13K-post corpus, they hit the empty dev DB by default. This is **not a code bug**; the Rust side sets the env var automatically in the Tauri sidecar path. But it's a real trap for anyone running the CLI manually.

## Why the timeout

`OllamaProvider.complete()` had `timeout=120.0` hardcoded on the `httpx.post(/api/generate)` call. For a 120-post-excerpt prompt (~70 KB) on a CPU-only llama3.2:3b:

- First-token latency: ~5–10 s (model warmup)
- Token/s throughput: ~20–30 tok/s on M-series CPU
- Max output: `num_predict=2048`
- **Wall-clock per call: 60–180 s** — under the limit for most runs, but extractors that hit the full 2048-token budget blew past 120 s consistently.

Four extractors (painpoints / features / complaints / DIY) × 120 s ceiling each = one silent timeout kills the whole `enrich` pipeline.

## Fix

`src/reddit_research/analyze/providers/ollama.py:58-86` — `complete()` now:

- Reads `OLLAMA_TIMEOUT` env var (float seconds), defaults to **600.0** s
- Passes that into `httpx.post`, so every Ollama generation call gets the budget
- User can lower (fast GPUs) or raise (huge prompts) without code changes

## Diagnosis — dual DB

Tauri's Rust `data_dir()` returns `$APPDATA/com.shantanu.openreply/reddit-myind/`, but the CLI default (when spawned outside Tauri) is `./data/` relative to CWD. Two separate SQLite files end up existing. Both work; they just don't share state.

**For CLI-against-app-data:**
```bash
export REDDIT_MYIND_DATA_DIR="$HOME/Library/Application Support/com.shantanu.openreply/reddit-myind"
reddit-cli info
```

Added to `docs/GAP_MAP_GUIDE.md` troubleshooting section + `docs/HOW_TO_USE.md`.

## Verification

- Provider resolution correct: `ollama` → `llama3.2:3b`, reply "OK" in 1.52 s
- JSON extraction test: `OllamaProvider.complete` returned parsable JSON shape
- DB via correct env var: 7,889 posts, 7,837 `topic_posts`, 13,313 `graph_nodes`, 23,033 `graph_edges`, **5 painpoints** (pre-reset), **0** features / products / workarounds
- Cleared stale painpoints: **5 → 0** semantic nodes, 23,033 → 23,011 edges
- Re-ran enrichment with new 600 s timeout (in progress at changelog write time)

## What this does *not* fix

The core "only 5 painpoints out of 13K posts" problem. That's the `corpus_limit=120` hard cap in `gaps.find_gaps` — the LLM only ever sees 120 posts regardless of corpus size. A future **batched enrichment** (chunked over 100 posts each, merged + deduped) is needed to actually use the full corpus. Proposed as the next bundle; the user hasn't yet approved the scope.

## Files Modified

- `src/reddit_research/analyze/providers/ollama.py` — configurable generation timeout

## Manual actions taken

- Cleared 5 stale painpoint nodes + 22 edges from the Tauri app's inner SQLite DB to enable a clean Ollama re-enrich (user said "reset and make it work").
