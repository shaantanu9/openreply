# Fix topic Chat hanging with no reply (LLM stream had no timeout)

**Date:** 2026-06-01
**Type:** Fix

## Summary

Topic Chat could "spin forever / never reply." Root cause: the LLM streaming clients in `research/chat.py` were constructed with **no HTTP timeout**, so the OpenAI/Anthropic SDKs fell back to their ~600 s default. When the configured provider accepted the connection but then stalled mid-stream — the classic "NVIDIA socket stall" / "ollama runner crashed mid-load" the code comments already warned about — the chat process hung with zero tokens and never exited, up to 10 minutes. The Tauri frontend's 5-minute hard watchdog fired first, so the user saw a spinner that appeared to hang indefinitely.

Added a streaming-aware `httpx.Timeout` (connect 15 s, read 120 s, write 30 s, pool 15 s) to every provider client. A short connect timeout fails fast when the endpoint is unreachable; the generous read timeout tolerates slow free-tier first-token latency (NVIDIA free-tier queue waits of 30-90 s are common) while still bounding a genuine mid-stream stall to ~2 minutes — after which the SDK raises and `cmd_research_chat` emits a clean `{event:"error"}` the UI surfaces immediately instead of an opaque spinner.

## Investigation

- Reproduced the exact `research chat --json` command against the local corpus via the dev venv: it streamed `start` → ~250 `token` events → `## Sources` → `done` in ~82 s on `nvidia / meta/llama-3.3-70b-instruct`. Backend, Rust dev-streaming plumbing (`run_dev_python_streaming`), and frontend wiring are all functionally correct.
- The variable latency (82 s one run, ~2 s to first token another) confirmed the "no reply" symptom is provider latency/stalls, not a logic bug — and that an unbounded client timeout turns a stall into a multi-minute hang.

## Changes

- Added `_stream_timeout()` helper returning an `httpx.Timeout` tuned for streaming.
- Passed `timeout=_stream_timeout()` to:
  - the Anthropic streaming client (`_stream_anthropic`)
  - the OpenAI-compatible streaming client (`_stream_openai_compatible`) — covers nvidia / openai / openrouter / groq / deepseek / mistral / google / ollama
  - both provider connectivity-test clients in `chat_meta`/test path (Anthropic + OpenAI-compatible) so the Settings "test key" ping can't hang either
- Verified `httpx` is a transitive dependency of both SDKs (import check passes); confirmed normal streaming still works after the change.

## Files Modified

- `src/openreply/research/chat.py` — new `_stream_timeout()` helper; timeout applied to 4 client constructions (2 streaming, 2 connectivity-test).

## Notes / recommendation

Backend chat works, but the configured provider is NVIDIA's free `llama-3.3-70b` endpoint, which is slow (~80 s for a full answer) and queue-limited. For a snappier Chat experience, switch the default provider/model in Settings → API keys to a faster option (e.g. Groq, or a local Ollama model). This is a user choice, not a code change.
