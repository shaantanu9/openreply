# Map / Evidence empty-state → actionable with provider info + bulk enrich

**Date:** 2026-04-24
**Type:** Fix + UX Enhancement

## Summary

Users reported that the Map tab's finding sections (Painpoints / DIY workarounds / Products / Feature wishes) were empty across almost every topic. Investigation showed 18 of 20 topics had zero rows of kind `painpoint`/`feature_wish`/`product`/`workaround` in `graph_nodes` — LLM extraction had either never run or had run and returned 0 findings (weak local Ollama models like `llama3.2:3b` / `gemma4:e2b` frequently extract nothing, and OpenRouter is out of credits on this install so its queue-worker batches failed 402).

The empty-state cards conflated three different failure modes ("never ran", "ran but model returned 0", "ran and errored") into one ambiguous "No extraction yet" message that only offered a single button. This fix distinguishes the modes, surfaces the exact provider/model/corpus-size that failed, and adds a bulk enrich path so users don't have to open every topic individually.

## Changes

- **Per-topic memo of last enrich result.** New module-level `_lastEnrichResult` map captures `{provider, model, added, error, skipped, corpusSize, droppedOffTopic}` after every `runEnrichFromMap` / `runEnrichHere` / auto-enrich call. Empty-state branches read it to pick the right copy.
- **Four-way Evidence empty-state branching** (was two):
  - Never ran + LLM ready → "Run extraction now" + "Enrich all topics"
  - Never ran + no LLM key → "Add LLM key"
  - Ran but 0 findings → shows `provider` / `model` / `corpus_size`, suggests stronger model (`ollama pull qwen2.5:7b` / Anthropic / OpenRouter), shows `dropped_off_topic` count when non-zero, offers Retry + Change LLM + Enrich all.
  - Ran with error → shows the real error text (truncated), offers Retry + Change LLM + Enrich all.
- **Map-tab auto-enrich banner** now records the result and renders inline action buttons (Change LLM, Retry) instead of an error string alone. Zero-findings case shows provider + corpus size, not a generic "try rerun collect" hint.
- **New `runEnrichAllTopics()` helper** iterates every topic with `count(topic_posts) ≥ 50` AND `count(graph_nodes kind='painpoint'|…) = 0`, calls `buildGraph` + `enrichGraph` sequentially (write-lock-friendly), and reports per-topic progress via callback + final toast. Exposed on `window.runEnrichAllTopics` for cross-screen use.
- **New "Enrich all" button** in the Map toolbar (visible whenever an LLM is configured) next to the existing "Enrich" button. Shows live progress (`3/18 · +7`) while running.

## Files Modified

- `app-tauri/src/screens/topic.js`:
  - Added `_lastEnrichResult` Map + `recordEnrichResult()` helper (new; ~30 lines near the top).
  - `runEnrichFromMap()` now calls `recordEnrichResult` on every branch.
  - `runEnrichHere()` now calls `recordEnrichResult` on every branch and the 0-findings toast includes `provider` + `corpus_size`.
  - `runEnrichAllTopics(onProgress)` added — sequential bulk enrich with progress + final summary toast. Exposed on `window`.
  - `loadEvidence()` empty-state branches expanded from 2 to 4 cases keyed on `_lastEnrichResult.get(topic)`.
  - `loadMap()` fire-and-forget auto-enrich records result and replaces plain error strings with actionable inline buttons.
  - Map toolbar gains `#btn-map-enrich-all` next to the per-topic Enrich button.

## Why the Root Cause Isn't "Worker Not Running"

The `extraction_queue` has ~24k pending rows across 19 topics with `attempts=0` (worker never touched them) and 5 Shopify rows maxed at `attempts=3` with `OpenRouter 402 + Ollama ReadTimeout` errors. The Rust supervisor (`app-tauri/src-tauri/src/worker.rs`) auto-starts the Python worker at boot when any topic has ≥100 posts. The worker is not the bottleneck — even when it runs, the same LLM that's failing per-topic (gemma4:e2b / llama3.2:3b returning 0 findings) would fail per-post too. Fixing the empty-state UX so users can see the real cause + switch provider + bulk-retry is higher leverage than retrying the queue against a broken LLM.

## Verification Done

- Syntax-checked `topic.js` via `node --input-type=module -e "import('./src/screens/topic.js')"` — OK.
- Ran `research graph enrich --topic <t>` via CLI on 8 topics; 2 produced findings (meditation → 11 painpoints + 2 products; home decor already had some), 6 returned 0 findings with provider=ollama — confirming the "ran but 0" UX branch matches reality.
- The query used by `runEnrichAllTopics` uses named-param semantics (`:topic` — but here none are required; the threshold is inlined since `run_query` binds `HashMap<String,String>`, not positional `?`).

## Known Limitations

- Small local Ollama models often extract 0 findings. The fix surfaces this; it does not make the model smarter. Users need to either pull a larger model (`ollama pull qwen2.5:7b`), top up OpenRouter, or add an Anthropic key.
- `runEnrichAllTopics` runs 20-90s per topic sequentially; a full pass over 20 topics can take 10-30 min. The button shows live progress so users know it's working, and the toast summarizes the final count.
