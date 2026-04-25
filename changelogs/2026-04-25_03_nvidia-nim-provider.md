# Add NVIDIA NIM as an OpenAI-compatible BYOK provider

**Date:** 2026-04-25
**Type:** Feature

## Summary

NVIDIA hosts an OpenAI-compatible chat-completions endpoint at
`https://integrate.api.nvidia.com/v1` (Llama, Gemma, Mixtral,
Nemotron, …). Drops in cleanly under the existing OpenAI-compat
provider plumbing — one new key + a few one-line registrations.

The user pasted a real API key in chat. **NOT embedded anywhere** —
that key should be considered leaked and rotated at https://build.nvidia.com.
The integration reads `NVIDIA_API_KEY` from the per-user BYOK env
file (same path every other provider uses).

## Changes

### Python sidecar

- `src/reddit_research/analyze/providers/openai.py` — added `"nvidia"`
  entry to `_PROVIDER_CONFIG` (env `NVIDIA_API_KEY`, base
  `https://integrate.api.nvidia.com/v1`, default model
  `meta/llama-3.3-70b-instruct`).
- `src/reddit_research/analyze/providers/base.py` — added `"nvidia"`
  to `_PROVIDER_ENV_KEY`, `_FALLBACK_ORDER`, and the
  `_build_single_provider` dispatch tuple.
- `src/reddit_research/research/chat.py` — added `"nvidia"` to
  `_OPENAI_COMPATIBLE` so the chat tab uses the same endpoint.

### Rust commands

- `app-tauri/src-tauri/src/commands.rs`:
  - `byok_status` masked-output object now includes `"nvidia":
    mask(&["NVIDIA_API_KEY"])` so the UI can detect a saved key.
  - `list_provider_models` gained `"nvidia" => fetch_openai_compat(…)`
    pointed at `https://integrate.api.nvidia.com/v1/models` so the
    "Refresh models" path returns NVIDIA's live catalogue.

### BYOK UI

- `app-tauri/src/screens/byok.js` — added an `LLM_PROVIDERS` entry for
  `nvidia` (label "NVIDIA NIM", color `#76B900`, prefix `nvapi-`,
  docs `https://build.nvidia.com`), plus a curated chip list of
  widely-available models (Llama 3.3 70B, Llama 3.1 8B, Mixtral
  8x22B, Gemma 2 27B, Nemotron 70B). Live `/v1/models` overrides the
  curated list when the key is set.
- `app-tauri/src/lib/llmStatus.js` — `nvidia` added to
  `CLOUD_PROVIDERS` so single-provider users count as ready.
- `app-tauri/src/screens/home.js`, `app-tauri/src/screens/topic.js` —
  three `anyReady` predicates extended with `b?.nvidia?.set`.

## How to verify after rebuild

1. **Save the key** — Settings → API keys → NVIDIA NIM → paste the
   (rotated) `nvapi-…` key → Save. Writes `NVIDIA_API_KEY=…` into
   `~/.config/reddit-myind/.env`.

2. **Browse the live catalogue** — open the NVIDIA card's model
   accordion. The frontend invokes `list_provider_models("nvidia")`
   → Rust hits `https://integrate.api.nvidia.com/v1/models` with the
   bearer header → returns the OpenAI-shape `{ data: [{ id, … }] }`.
   Click any chip to set it as the active default.

3. **Test it** — same card has a "Test" button. Calls
   `api.testLlm('nvidia', model)` → CLI `research test-llm
   --provider nvidia --model …` → `OpenAIProvider(provider='nvidia')`
   sends a 5-token ping + reports latency.

4. **End-to-end** — set `LLM_PROVIDER=nvidia` and `LLM_MODEL=<id>`
   from the chips. From the Map tab on any topic, click Enrich. The
   chain in `build_fallback_chain` honours the user pick and routes
   through the NVIDIA endpoint.

## Files Modified

- `src/reddit_research/analyze/providers/openai.py`
- `src/reddit_research/analyze/providers/base.py`
- `src/reddit_research/research/chat.py`
- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src/screens/byok.js`
- `app-tauri/src/lib/llmStatus.js`
- `app-tauri/src/screens/home.js`
- `app-tauri/src/screens/topic.js`

## Verification

- `cargo check` in `app-tauri/src-tauri` — clean.
- `node --input-type=module -e "import('./src/screens/{byok,topic,home}.js')"` — all OK.

## Security note

The pasted `nvapi-6W1-…` key was visible in chat history. Treat it as
compromised: rotate at https://build.nvidia.com (Account → API keys →
Revoke + Generate new), then enter the fresh value via the BYOK UI.
The new key never leaves your local `.env`.
