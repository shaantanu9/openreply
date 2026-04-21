# Insights: parse OpenRouter "can only afford N" + direct-action CTA on 402

**Date:** 2026-04-20
**Type:** Fix

## Summary

Insights synth failed with `402 — you requested up to 2000 tokens, but can only afford 226` even though the retry loop existed. Two problems: (a) the retry floor was 2000 tokens, higher than the user's remaining credits, so every retry hit the same cap; (b) the frontend error showed "Retry" only — no actionable path forward when the provider was simply out of credits.

## Changes

### `src/reddit_research/research/insights.py`

- Retry-budget list: `[provider_budget, provider_budget/2, 2000, 300]`. The 300-token floor lets a credit-exhausted provider still produce *some* output instead of failing outright.
- New primary retry: parse `"can only afford N"` from the error, retry with `max(100, N-20)`. OpenRouter tells us exactly how many tokens remain — use that instead of guessing.
- Error response now includes `error_code` (`credits_exhausted` / `invalid_key` / `context_overflow`) and `provider` so the UI can render the right CTA.

### `src/reddit_research/research/monitor.py::monitor_run_topic`

Propagates `error_code` + `provider` from synth failures up to the Tauri command result.

### `app-tauri/src/screens/insights.js::renderError`

Now takes `(err, errCode, provider)`. On `credits_exhausted` → adds a "Switch provider in Settings" button. On `invalid_key` → "Re-enter API key" button. Generic retry stays for unclassified errors. Provider name pill shows `provider: <name>` so the user can tell at a glance which BYOK key is failing.

## Why the regex catches OpenRouter specifically

OpenRouter's 402 body format: `"you requested up to 2000 tokens, but can only afford 226"`. The lowercased substring `"can only afford 226"` is matched by `r"can only afford\s+(\d+)"`. Verified with the exact error text the user pasted.

## Verification

- `.venv/bin/python` import `reddit_research.research.insights` — clean.
- Regex test against user's pasted error → extracts `226` correctly.
- `node --check insights.js` → clean.

## What to do next time this happens

1. The app will try harder: attempt at 2000 → fall back to 300 → final shot with the parsed 226.
2. If it still fails (226 is genuinely too small to produce JSON), the error screen now has a "Switch provider in Settings" button — click it to open Settings, switch the active provider to Ollama or Groq (both free), save, return to Insights, click Retry. Cached `.insights_cache` is untouched.

## Files Modified

- `src/reddit_research/research/insights.py`
- `src/reddit_research/research/monitor.py`
- `app-tauri/src/screens/insights.js`
