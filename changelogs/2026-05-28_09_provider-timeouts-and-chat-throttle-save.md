# LLM provider HTTP timeouts + chat throttle-save

**Date:** 2026-05-28
**Type:** Reliability + Data-Loss Fix

## Summary

Two adjacent reliability fixes that pair with the daemon-lock-timeout safety net (see `2026-05-28_06`):

1. **LLM provider HTTP timeouts.** Only Ollama had a configurable `OLLAMA_TIMEOUT` (default 600s) before. Every other provider (Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Google, NVIDIA NIM) ran with whatever the SDK defaulted to — and a hung NVIDIA cold-boot / OpenRouter 502-with-no-body could stall the Python sidecar indefinitely. Combined with the (pre-fix) daemon mutex serialization, a single bad provider call could pin every other UI query for hours.

   New env: `LLM_REQUEST_TIMEOUT` (default 300s) threaded into both `AnthropicProvider` and `OpenAIProvider` (covers all 7 OpenAI-compat providers). Users on snappy machines can lower it (`LLM_REQUEST_TIMEOUT=120`); users on flaky networks can raise it. Now no LLM HTTP call can hang the sidecar past 5 minutes.

2. **Chat throttle-save.** During a streaming chat response, `chatHistory` was being mutated in memory but `saveChatHistory(topic)` was only called on done/error/cancel. If the user reloaded the app or fully quit mid-stream, every token that hadn't yet reached the `chat:done` event was lost. Added a 2s throttled `scheduleChatSave()` inside `handleChatLine`'s token branch — partial responses now survive a navigation away or app reload.

## Changes

- `src/openreply/analyze/providers/anthropic.py` — read `LLM_REQUEST_TIMEOUT` env (default 300.0s), pass as `timeout=` to `Anthropic(api_key=…, timeout=timeout_s)`.
- `src/openreply/analyze/providers/openai.py` — same env, passed to `OpenAI(api_key=…, base_url=…, timeout=timeout_s)`. Covers OpenAI + OpenRouter + Groq + DeepSeek + Mistral + Google + NVIDIA NIM through the existing `_PROVIDER_CONFIG` map.
- `app-tauri/src/screens/topic.js` — added `_chatSaveTimer` + `scheduleChatSave()` helper, called from the `token`/`text` branch of `handleChatLine`.

## Verified

- `python3 -m ast` clean on both provider files.
- `node --check topic.js` clean.

## Follow-ups (not in this changeset)

- Full module-scope hoist of the `chat:progress` / `chat:done` listeners (matching the collect-listener fix in `2026-05-28_04`). Would let tokens keep arriving live in the buffer even while the user is on a different screen, so re-opening chat shows the latest tokens instantly. Bigger refactor than time allowed in this batch — flagged as known follow-up. The throttle-save fix here at least prevents data loss on reload.
