# Chat: fix the 57s context-build stall ("chat hangs after start event")

**Date:** 2026-06-02
**Type:** Fix (performance)

## Summary

Found and fixed the dominant cause of chat appearing to hang on large topics:
`_topic_context` took **~57 s** to build a tiny (4.9 KB) context before the LLM
was ever called, so the chat emitted only the `start` event and then sat
silent. This is independent of the palace and independent of any running
collect — it reproduced with the palace disabled and on warm runs. Two slow
operations in the chat hot path:

1. **A pathological SQL `source_diversity` subquery (the 54 s).** The
   per-finding-node ranking joined `graph_edges` to `posts` with
   `e2.src = :prefix || p.id OR e2.dst = :prefix || p.id`. Concatenating the
   topic prefix onto every post id defeats the `posts` primary-key index, so
   SQLite did a full `posts` scan (157 k rows) **per edge, per finding node** —
   and `ORDER BY source_diversity` forced it for ALL nodes of each kind (124
   painpoints + 88 workarounds + 62 feature_wishes), not just the top 12.
   O(nodes × edges × posts). Rewritten to look posts up **by primary key** via
   `p.id = substr(CASE WHEN e2.src=gn.id THEN e2.dst ELSE e2.src END,
   length(:prefix)+1)`. Same results, **~545× faster (54 s → 0.1 s)**.

2. **Synchronous paper full-text downloads (5-15 s each).** `_topic_context`
   called `get_full_text(post_id)` per academic-paper citation, which DOWNLOADS
   + extracts the PDF on a cache miss — contradicting its own comment ("we
   DON'T trigger downloads here"). Added a `cache_only=True` mode to
   `get_full_text` (returns `status='not_cached'` instead of fetching) and the
   chat callsite now uses it. Full text is populated ahead of time by the
   research pipeline.

After both: `_topic_context` is ~4.7 s (one-time palace ONNX cold-start) and a
real chat streams to completion (verified: 256 tokens, `done`, no error).

## Files Modified

- `src/openreply/research/chat.py` — PK-lookup rewrite of the `source_diversity`
  subquery; `get_full_text(..., cache_only=True)` at the full-text splice.
- `src/openreply/research/paper_fulltext.py` — `get_full_text(cache_only=...)`
  param + cold-cache short-circuit before the network download.

## Files Created

- `changelogs/2026-06-02_04_chat-topic-context-57s-stall-fix.md`

## Verification

- `_topic_context("calari tracking app", …)`: 57.6 s → **4.74 s**.
- Isolated SQL: findings loop 54.5 s → **0.10 s** (join-flip), same counts.
- End-to-end `research chat`: streamed **256 tokens, done, no error**.
