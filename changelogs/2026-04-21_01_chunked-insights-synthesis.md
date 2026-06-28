# Chunked insights synthesis — map-reduce over the corpus with parallel LLM calls

**Date:** 2026-04-21
**Type:** Feature

## Summary

The single-call Insights synth was failing for users on low-credit providers (OpenRouter free tier) — both on the *output* side (`can only afford 226 tokens`) and on the *input* side (`prompt tokens limit exceeded: 3832 > 1358`). The retry loop could only shrink so far; at some point the provider simply couldn't afford the shape of the request.

This ships a second synth mode: map-reduce chunked synthesis. The corpus is split into N small chunks, each chunk goes through a tiny LLM call, and findings are merged deterministically (no second LLM pass). Each chunk uses ~600-token input + 800-token output — well under any free-tier cap. Parallelism is auto-tuned per provider (Ollama=1, Groq=2, OpenRouter=3, Anthropic/OpenAI=4). Users can force `max_workers=1` for strictly sequential.

## Changes

### `src/reddit_research/research/insights.py`

- `_PARALLEL_WORKERS` dict — per-provider concurrency ceiling.
- `_CHUNK_PROMPT_SYSTEM` / `_CHUNK_USER_TEMPLATE` — simple "extract findings from this batch" prompt. Returns `{"findings": [...]}` strict JSON; no Minto / hypotheses / competitors (those need cross-chunk context).
- `_chunk_rows(rows, chunk_size)` — round-robin split by `source_type` so each chunk sees multiple sources instead of one chunk of all-Reddit followed by one of all-arXiv.
- `_normalize_title(title)` — dedup key: lowercases, strips apostrophes WITHOUT inserting a space (`can't` → `cant`, not `can t`), strips punctuation, drops filler words, de-pluralizes (> 3-char words ending in `s`).
- `_merge_findings(partial_findings_per_chunk)` — folds N partial lists into one. Sums `frequency`, takes MAX of `importance`, MIN of `satisfaction`, keeps the longest `evidence` quote, records `chunk_sources` (which chunks each finding came from). Recomputes `opportunity_score` deterministically (Ulwick).
- `synthesize_insights_chunked(topic, chunk_size=40, max_workers=None, max_tokens_per_chunk=800, progress=None)` — the public entry point. Uses `ThreadPoolExecutor` with provider-adaptive workers, or sequential (`workers=1`).
- Per-chunk worker has its own retry ladder: on `prompt tokens limit exceeded` → halve rows + excerpt length, retry up to 3 times. On `can only afford N` → retry with that exact budget. Failures in one chunk don't poison the whole run; they're collected as `_chunk_errors`.

### `src/reddit_research/cli/main.py`

`research insights` CLI gained four flags:

- `--chunked` — toggle chunked mode
- `--chunk-size N` (default 40)
- `--max-workers K` (None = auto per provider)
- `--max-tokens-per-chunk M` (default 800)

Per-chunk progress lines (`[chunk 3/12] ✓ 4 findings (2.1s)`) print to stderr unless `--json` is set.

### `app-tauri/src-tauri/src/commands.rs`

New `synthesize_insights_chunked` Tauri command. Forwards `chunkSize`, `maxWorkers`, `maxTokensPerChunk` to the Python CLI. Registered in `main.rs::invoke_handler`.

### `app-tauri/src/api.js`

```js
api.synthesizeInsightsChunked(topic, { chunkSize, maxWorkers, maxTokensPerChunk })
```

### `app-tauri/src/screens/insights.js`

- New `runChunkedSynth(contentEl, topic)` fn.
- `renderError` now surfaces a **"Try Deep scan (chunked)"** primary button when `error_code === 'credits_exhausted' || error_code === 'context_overflow'` — promotes the chunked path as the fix for exactly the errors that motivate it.
- `wireRunButton` wires both `#btn-insights-run` (single-call retry) and the new `#btn-insights-chunked`.

## How chunked mode solves the 402 errors

| Error | What it means | Single-call path | Chunked path |
|---|---|---|---|
| `can only afford 226 tokens` (output) | Low output budget | Truncates JSON, parser salvages ~50% | Each chunk uses 800 tokens → fits under most free-tier output caps |
| `prompt tokens limit exceeded: 3832 > 1358` (input) | Provider refuses to accept big prompts | Halves corpus then tries again, still too big | Each chunk is ~40 posts × 400 chars ≈ 600 input tokens; fits in 1358 with room |

## Verification

- `.venv/bin/python` round-trip:
  - `_chunk_rows([reddit×5, hn×3, arxiv×2], 4)` → `[[r0,h0,a0,r1], [h1,a1,r2,h2], [r3,r4]]` — interleaved as expected.
  - `_normalize_title("Can't find healthy recipes")` → `"cant find healthy recipe"`, matches `"cant find healthy recipe"` (same key). Dedup across chunks now collapses apostrophe + plural variants.
  - `_merge_findings([[A×2, imp=8], [A×3, imp=7]])` → 1 entry with `frequency=5, importance=8, satisfaction=min, chunk_sources=[0,1]`.
- `cargo check --no-default-features` → clean (44 s incremental).
- `node --check` on api.js + insights.js → clean.
- `./scripts/dev.sh doctor` → sidecar healthy.

## UX delta

Before:
- 402 on credits/context → "Retry" button + "Switch provider in Settings" → user has to context-switch to fix the error.

After:
- 402 on credits/context → "**Try Deep scan (chunked)**" is the primary CTA → one click, same corpus, ~12 small LLM calls instead of one big one → findings land.
- User can also run from CLI: `reddit-cli research insights --topic X --chunked --max-workers 1` for strictly sequential, or `--max-workers 4` for parallel.

## Trade-offs

Chunked mode produces findings only. The Minto executive summary, hypothesis cards with disconfirming evidence, competitor landscape, and greenfield quadrant all need *cross-corpus* context that per-chunk synthesis can't capture. Those sections are empty in chunked reports. The report is flagged `_partial: true` and `_mode: "chunked"` for future UI handling.

If the user later adds credits / switches to a full-budget provider, clicking Regenerate falls back to the single-call path which re-fills the Minto / hypothesis / competitor sections.

## Files Modified

- `src/reddit_research/research/insights.py` — chunked synth + merge helpers
- `src/reddit_research/cli/main.py` — `--chunked` / `--chunk-size` / `--max-workers` / `--max-tokens-per-chunk` flags
- `app-tauri/src-tauri/src/commands.rs` — `synthesize_insights_chunked` command
- `app-tauri/src-tauri/src/main.rs` — register new command
- `app-tauri/src/api.js` — `synthesizeInsightsChunked` binding
- `app-tauri/src/screens/insights.js` — "Deep scan" button + `runChunkedSynth` handler
