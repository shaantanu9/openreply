# Chat no longer hangs while a collection is running (palace read timeout)

**Date:** 2026-06-02
**Type:** Fix

## Summary

Diagnosed and fixed "chat hangs when a collection is going". Root cause is
cross-process contention on the ChromaDB **memory palace**: during a collect,
the long-lived `enrich-worker --serve` process upserts embeddings into
`<data_dir>/palace/chroma.sqlite3` (+ HNSW index), and chat's grounding step
reads the *same* store from a *different* process. ChromaDB's persistent store
is not safe for concurrent cross-process write+read, so chat's inline
`palace.stats()` / `palace.search_posts()` calls blocked on the writer's lock
— with no timeout — for the whole duration of the collect. (The main
`openreply.db` is WAL + `busy_timeout=5000`, so it was never the culprit.)

Fix: bound chat's palace reads with a wall-clock ceiling and fall back to the
existing engagement-ranked SQL retrieval on timeout. The hang becomes a short
graceful degrade — chat always answers, semantically when the palace is free,
from SQL when it's busy.

## Changes

- `src/openreply/research/chat.py`:
  - New `_call_with_timeout(fn, timeout_s)` helper — runs a blocking
    palace/ChromaDB call on a daemon thread and returns `(False, None)` on
    timeout instead of waiting (deliberately NOT a ThreadPoolExecutor
    `with`-block, whose `shutdown(wait=True)` would re-introduce the hang).
  - New `_PALACE_CHAT_TIMEOUT` (env `OPENREPLY_PALACE_CHAT_TIMEOUT`, default 3 s).
  - `_semantic_evidence` (the ASK/RAG grounding path) now runs the stats-gate
    + `search_posts` under the ceiling; on timeout → `([], "")` → SQL fallback.
  - The agent-mode `semantic_search` tool is bounded the same way (returns a
    `{skipped: true}` hint telling the model to use `run_query`/`get_findings`).

## Files Created

- `tests/test_chat_palace_timeout.py` — regression: a blocking palace must make
  chat fall back within the ceiling (not hang); a free palace adds no penalty.
- `changelogs/2026-06-02_02_chat-no-hang-during-collect-palace-timeout.md`

## Files Modified

- `src/openreply/research/chat.py`

## Verification

Standalone harness (pytest temporarily absent from the venv):
- blocking palace (sleep 30 s), 0.5 s ceiling → chat returns `([], "")` in
  **0.51 s** (was: indefinite hang).
- free palace → returns in **0.00 s** (no wrapper penalty).

## Known follow-ups (faster/“proper” flow)

- Reduce contention at the source: have `enrich-worker` back off ChromaDB
  writes (or checkpoint) while a chat is streaming, so chat can get *semantic*
  results even mid-collect instead of falling back to SQL.
- Warm the MiniLM ONNX embedder once at chat start to avoid a cold first query.
- Longer term: a single ChromaDB owner (worker) with chat querying via IPC,
  removing cross-process store access entirely.
