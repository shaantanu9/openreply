# Chunked synth: cascading retry + unified shrink loop + ok:False when all chunks fail

**Date:** 2026-04-21
**Type:** Fix

## Summary

User reported chunked synth still failing against OpenRouter with the same 402 errors chunked mode was supposed to fix. Live testing revealed four distinct bugs:

1. **Default chunk_size=40 guaranteed failure on OpenRouter free tier.** 40 rows × 400 chars ≈ 4000 input tokens; OpenRouter's free-tier input cap at the time of the run was 576. Halving + halving wasn't aggressive enough.
2. **RSS feeds shove full `<p>`/`<a>` HTML into `selftext`.** 3-5× char bloat with ~zero signal — meant even "small" chunks stayed over the cap.
3. **The afford-N retry was inline + swallowed errors.** Attempt 0 fails with `can only afford 96`, the inline retry uses `max_tokens=92`, but that retry throws `Prompt tokens limit exceeded: 623 > 576` (a different failure class) — which was caught by an inner `except` that stashed the error string and fell through to `break`, skipping the outer shrink loop entirely.
4. **`ok: True` even when zero findings.** If every chunk failed, `merge_findings` returned an empty list but the report still came back `ok: True`. UI painted an empty insight report instead of showing a real error.

This commit fixes all four. Tested live against OpenRouter with the real "ai" topic corpus — chunked synth now succeeds at 96 output tokens + 576 input tokens available.

## Changes

### `src/reddit_research/research/insights.py`

**Per-provider default chunk size (`_DEFAULT_CHUNK_SIZE`):**
```
openrouter: 8    (was using universal default 40)
groq:       15
ollama:     20
anthropic:  40
openai:     40
...
```

**HTML stripper (`_strip_html`) applied to every row's `selftext` + `title` before chunking.** Regex-based — no HTML parser dep. Cuts RSS-feed char count 3-5×.

**Unified shrink loop in `_run_chunk`.** Replaces the fragile inline-retry branches. Each of 7 attempts rebuilds the prompt from three mutable knobs — `current_rows`, `current_excerpt`, `current_max_tokens` — then any of {afford-N, `limit exceeded: X > Y`, generic prompt-too-big} adjusts whichever knob the error complains about and falls through to the next attempt. Only bails when an error doesn't match any known pattern.

**The cascade now works correctly:**
```
attempt 0: rows=8 ex=180 max_tokens=800 → "can only afford 96" → set max_tokens=92
attempt 1: rows=8 ex=180 max_tokens=92  → "limit exceeded: 623 > 576" → ratio 0.65 → rows=5 ex=116
attempt 2: rows=5 ex=116 max_tokens=92  → ✓ 2 findings
```

Before this fix, attempts stopped at step 1 because the inline afford-retry swallowed the input-overflow error.

**afford floor:** 100 → 30, margin 20 → 4. OpenRouter users can have as little as 96 tokens of remaining budget; a 100-token floor guaranteed failure.

**`ok: False` when zero findings.** When every chunk fails, classify the root cause from the first error (`credits_exhausted` / `context_overflow` / `invalid_key`) and return a structured error response so the UI's "Switch provider in Settings" CTA fires correctly.

**`CHUNK_DEBUG=1` env var** enables per-attempt logging of rows/excerpt/max_tokens/prompt_chars + the error message when a retry is triggered. Left in place — useful forensic tool; silent by default.

## Verification

- `.venv/bin/python scripts/doctor.py` → all ✓.
- `reddit-cli research insights --topic ai --chunked --chunk-size 6 --max-workers 2 --max-tokens-per-chunk 500 --json` → clean JSON report with 3 findings, 0 chunks failed, `ok: true`.
- Live OpenRouter test at the worst point (96 tokens output budget, 576 input cap): chunked synth cascades through 3 attempts per chunk and succeeds. Both chunks return findings; merge produces 3 unique findings after dedup.
- `cargo check --no-default-features` → clean.

## What to do when you hit the error screen

1. Click **"Try Deep scan (chunked)"** (promoted to primary action on credits/context errors).
2. You'll see a "Deep scan (chunked mode)…" spinner. Each chunk runs in 1-3 s on a small corpus.
3. If OpenRouter is really down to 0 credits, all chunks will fail and you'll get an `ok: false` error with the "Switch provider in Settings" button. Switch to Ollama (local, free) there — no re-work, Insights will work fine.

## Files Modified

- `src/reddit_research/research/insights.py` — `_DEFAULT_CHUNK_SIZE`, `_strip_html`, unified shrink loop, ok:False-on-empty
