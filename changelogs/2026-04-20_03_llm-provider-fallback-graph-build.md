# Provider fallback + model-probe fixes so graph enrichment survives broken providers

**Date:** 2026-04-20
**Type:** Fix

## Summary

Gap-map enrichment was silently failing (0 painpoints / features / workarounds ever written to `graph_nodes`) because the LLM layer had no fallback: if the user's configured provider hit a transient error (Ollama runner crashed, OpenRouter free-tier 429, wrong model auto-picked, invalid key), the one-and-only attempt failed and nothing else was tried. Users saw "graph map not getting built" even though the structural graph was fine — only the semantic enrichment step died.

Three code bugs, all fixed in this change:

1. **No fallback across providers.** `enrich_from_llm` resolved a single provider, pinned it, and gave up on first failure. Now uses a FallbackProvider that walks the entire configured chain on every `.complete()` call.
2. **`LLM_MODEL` was read across providers.** When `LLM_PROVIDER=openrouter` the env-set `LLM_MODEL` is an OpenRouter model string (e.g. `google/gemma-4-26b-a4b-it:free`). The Ollama provider used to read the same env var and try to load that name — always 404. Now LLM_MODEL is only honoured when `LLM_PROVIDER=ollama`; otherwise Ollama auto-picks a real local model.
3. **Auto-pick selected cloud-gated models.** Ollama's `/api/tags` lists `:cloud` models (like `glm-5.1:cloud`) which require an upstream key; auto-picking them silently returned 401. Now filtered out.

## Changes

- `src/reddit_research/analyze/providers/base.py` — **rewritten**.
  - `FallbackProvider(LLMProvider)` — walks the configured chain on every call; aggregates per-provider failure reasons into a single error.
  - `build_fallback_chain(preferred=None)` — ordered list of providers to try: explicit arg → `LLM_PROVIDER` env → every cloud key that's set → local Ollama if reachable.
  - `_ollama_reachable()` kept; new `_ollama_model_ready(model)` probes `/api/show` to verify a specific model is callable (catches the "llama runner process no longer running" failure mode without falsely tripping when a model name from another provider is in `LLM_MODEL`).
  - `get_provider(None)` now returns a FallbackProvider (transparent fall-through). `get_provider(name)` still returns a pinned single provider (no surprises when the user picked one explicitly).
  - `resolve_provider(…)` kept for back-compat — returns the chain head.
- `src/reddit_research/graph/semantic.py::enrich_from_llm`
  - Pre-flight now uses `build_fallback_chain()` — if empty → `{skipped, reason}`. Otherwise we pass the original (possibly `None`) `provider` into `find_gaps` so `get_provider(None)` produces a FallbackProvider.
  - Return payload now includes `provider_chain` so the UI can surface which providers were tried.
- `src/reddit_research/research/gaps.py::find_gaps`
  - Uses `resolve_provider` only to *peek* at the chain head for perf tuning (Ollama gets smaller corpus + shorter context). The original `provider` value (possibly `None`) is still passed through to `run_extractor` so the FallbackProvider path is preserved.
- `src/reddit_research/analyze/providers/ollama.py`
  - `OllamaProvider.__init__` now only reads `LLM_MODEL` when `LLM_PROVIDER=ollama`. Otherwise auto-picks.
  - `_autopick_ollama_model` now skips names ending `:cloud` so cloud-gated models aren't auto-selected.

## Files Modified

- `src/reddit_research/analyze/providers/base.py`
- `src/reddit_research/analyze/providers/ollama.py`
- `src/reddit_research/graph/semantic.py`
- `src/reddit_research/research/gaps.py`

## Verification

- `pytest -q tests/ --ignore=tests/test_integration.py` → **20 / 20 pass**.
- Manual enrich call against the real gapmap DB proves the fallback:
  - Before fix: `Ollama 500 for model 'llama3.2:3b': llama runner process no longer running` → zero findings written, no retry.
  - After fix: when preferred provider fails, the walker tries each remaining candidate and surfaces an aggregated error listing every provider + its reason. When a provider works, findings land in `graph_nodes`.
- The stacked-orphan-process symptom documented in `cli.rs` (11 concurrent enrichments locking SQLite) also shrinks naturally once each call either succeeds or fails fast, rather than hanging on a broken provider.

## Known follow-ups (not in this change)

- **Tauri-startup orphan cleanup.** If the user restarts the app while a Python enrichment is still running, the previous child becomes an orphan. The in-memory `ActiveGraphOps` HashSet is reset on restart so duplicates can spawn. A pidfile or ps-scan sweep at Tauri startup would eliminate this. Open ticket — not required for this fix.
- **UI surfacing of `provider_chain`.** The enrich response now carries `provider_chain`; a future small change to `runEnrichHere` can toast "Used OpenRouter (Ollama unavailable)" when fallback kicks in.
