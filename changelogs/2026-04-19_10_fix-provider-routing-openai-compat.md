# Fix: LLM provider routing actually honors LLM_PROVIDER

**Date:** 2026-04-19
**Type:** Fix

## Summary

The app UI lets you save keys for OpenRouter / Groq / DeepSeek / Mistral / Google / OpenAI and pick one as the default LLM, but for any analysis flow (painpoints extraction, theme clustering, graph enrichment) the sidecar silently rerouted every OpenAI-compatible provider into `OpenAIProvider()` — which was hardcoded to the OpenAI API and the `OPENAI_API_KEY` env var. Users with a valid OpenRouter/Groq/Mistral/etc. key got a `RuntimeError: OPENAI_API_KEY not set` even though their saved config was correct.

(The chat feature already worked correctly via a separate `_OPENAI_COMPATIBLE` map in `research/chat.py`. This was only broken for analysis.)

## Root cause

`src/reddit_research/analyze/providers/base.py::get_provider()` routed every openai-compatible provider to `OpenAIProvider()` with no arguments:

```python
if resolved in ("openai", "openrouter", "groq", "deepseek", "mistral", "google"):
    from .openai import OpenAIProvider
    return OpenAIProvider()   # ← no provider arg; defaults to OpenAI-only code path
```

And `OpenAIProvider` itself hardcoded `OPENAI_API_KEY`, default model `gpt-4o-mini`, and the default OpenAI base URL.

## Fix

Rewrote `OpenAIProvider` to accept a `provider` arg and handle all six OpenAI-compatible APIs via a `_PROVIDER_CONFIG` table (env var + base URL + default model per provider). It now reads `LLM_MODEL` from the environment so the model the user picked in Settings actually flows through.

Updated `get_provider` to pass the resolved provider name into the constructor.

## Verification

```
$ .venv/bin/python -c "from reddit_research.core import config; \
  from reddit_research.analyze.providers.base import get_provider; \
  p = get_provider(); print(p.name, p._model, p._client.base_url); \
  print(p.complete('Reply exactly: OK', max_tokens=20, temperature=0))"
openrouter openai/gpt-4o https://openrouter.ai/api/v1/
OK
```

`pytest -x -q` — 12 passed, 1 skipped (no regressions).

## Files Modified

- `src/reddit_research/analyze/providers/openai.py` — accepts `provider` arg; per-provider env key, base URL, default model; reads `LLM_MODEL` from env
- `src/reddit_research/analyze/providers/base.py` — `get_provider` now passes the resolved provider name into `OpenAIProvider(provider=resolved)`

## Note on production builds

Dev mode reads `.venv/bin/python` directly (battle-tested dev-venv bypass), so these changes take effect immediately on `npm run tauri dev`. For a production DMG, the PyInstaller sidecar must be rebuilt:

```bash
pyinstaller reddit-cli.spec \
  && cp dist/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin \
  && codesign --force --deep --sign - app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
```
