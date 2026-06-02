# Enrich-worker yields ChromaDB while a chat is reading the palace

**Date:** 2026-06-02
**Type:** Feature (performance / concurrency)

## Summary

Follow-up #1 to the chat-hang fix (`2026-06-02_02`). The read timeout stopped
chat from hanging during a collect, but chat still *degraded to SQL* mid-collect
because the enrich-worker kept embedding into the ChromaDB palace while chat
tried to read it. This adds a lightweight cross-process heartbeat so the worker
**defers its embedding batches while a chat is actively reading the palace** —
letting chat keep its *semantic* (memory-palace) quality even during a collect,
instead of falling back to SQL.

## How it works

- New `src/gapmap/core/coordination.py`: a heartbeat file
  `<data_dir>/.chat_active`.
  - `mark_chat_active()` — chat touches it (current time) around each palace read.
  - `is_chat_active(ttl=10s)` — true if the heartbeat is fresh.
  - Best-effort: any failure → no-op (the read timeout still prevents a hang).
- `chat.py` calls `mark_chat_active()` in `_semantic_evidence` (ASK path) and in
  the agent `semantic_search` tool, right before the palace read.
- `enrich_worker.serve()` checks `is_chat_active()` at the top of each loop
  iteration. While a chat is active it naps (`CHAT_BACKOFF_TICK`, default 2 s)
  and re-checks instead of draining a batch — rows stay queued (crash-safe).
  A **starvation cap** (`CHAT_BACKOFF_MAX`, default 30 s) forces one batch
  through if chatting is continuous, so enrichment still progresses. Emits
  `enrich:chat_backoff` (state: defer / forced_drain / resume) for observability.

## Tuning (env)

- `GAPMAP_CHAT_ACTIVE_TTL` (default 10) — heartbeat freshness window.
- `GAPMAP_ENRICH_CHAT_BACKOFF_TICK` (default 2) — worker re-check nap.
- `GAPMAP_ENRICH_CHAT_BACKOFF_MAX` (default 30) — anti-starvation cap.

## Files Created

- `src/gapmap/core/coordination.py`
- `changelogs/2026-06-02_03_enrich-worker-chat-backoff.md`

## Files Modified

- `src/gapmap/research/chat.py` — heartbeat in `_semantic_evidence` + `semantic_search` tool.
- `src/gapmap/research/enrich_worker.py` — `CHAT_BACKOFF_*` constants + backoff block in `serve()`.

## Verification

- All three modules `py_compile` clean; `enrich_worker` imports (constants load).
- Coordination round-trip: `mark_chat_active()` → `is_chat_active()` True, flag
  at `…/com.shantanu.gapmap/gapmap/.chat_active`, expires on TTL=0.
- Combined effect during a collect: chat read either returns semantic results
  (worker now yields) or, if it just missed the window, times out to SQL in ≤3 s
  — never hangs.
