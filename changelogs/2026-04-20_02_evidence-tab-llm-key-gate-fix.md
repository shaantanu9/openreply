# Evidence tab: fix misleading "Add LLM key" loop + share one LLM-status helper

**Date:** 2026-04-20
**Type:** Fix

## Summary

The Evidence tab was asking users to "Add an LLM key" whenever the findings table had 0 rows for the topic, regardless of whether a key was already configured. Users who had correctly saved a key in Settings (cloud or local Ollama) saw the same empty-state every time they clicked — and re-saving the key did nothing because the real need was to run extraction, not add a key. Report tab error path had the same bug.

Root cause was in `topic.js::loadEvidence` (and `loadReport`'s error actions): the copy was hard-coded assuming "empty findings ⇒ no LLM". Fix branches on `byokStatus()` — "Run extraction now" when a provider is ready, "Add LLM key" only when none is.

Also consolidated two near-duplicate `hasLlmConfigured` / `checkLlmReady` helpers (one in `main.js`, one in `topic.js`) into a single shared module so every screen reads LLM status the same way and local Ollama always counts equally with cloud keys.

## Changes

- `loadEvidence` empty state now branches on `hasLlmConfigured()`. New "Run extraction now" button wires to `runEnrichHere()` which does `buildGraph + enrichGraph` with toast feedback, then reloads the tab.
- `loadEvidence` and `loadReport` error-path actions also branch: "Run extraction" replaces "Add LLM key" when a provider is already configured.
- New `runEnrichHere(btnSelector, onDone)` helper — mirrors `runEnrichFromMap` but reloads the caller, idempotently builds the graph first, toasts the outcome.
- Extracted `hasLlmConfigured()` into `app-tauri/src/lib/llmStatus.js`. Accepts cloud keys (Anthropic / OpenAI / OpenRouter / Groq / DeepSeek / Mistral / Gemini) AND local Ollama (`ollama` flag or `ollama_base_url`). Added a richer `llmStatus()` variant that returns which providers are ready.
- `main.js` now imports from the shared module instead of defining its own copy.
- `topic.js::checkLlmReady` becomes a thin alias for `hasLlmConfigured` so `loadMap`'s existing auto-enrich path also accepts local Ollama without an explicit base URL check.

## Files Created

- `app-tauri/src/lib/llmStatus.js` — shared helper.

## Files Modified

- `app-tauri/src/main.js` — import shared helper, remove inline duplicate.
- `app-tauri/src/screens/topic.js` — import helper, add `runEnrichHere`, branch Evidence empty + Report error actions, alias `checkLlmReady` to shared helper.
- `changelogs/2026-04-20_02_evidence-tab-llm-key-gate-fix.md` — this entry.

## Manual verification

1. Configure an LLM key in Settings (Anthropic / OpenAI / or local Ollama base URL).
2. Open a topic whose extraction has not yet run.
3. Click Evidence → should show **"No extraction has run yet on this topic"** + **Run extraction now** button (not the old "Add LLM key" copy).
4. Clicking the button should toast the outcome and refresh with populated findings.
5. With all keys removed in Settings, same tab should show the classic "Add LLM key" copy again.
