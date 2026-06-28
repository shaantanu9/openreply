# Paper Chat + Paper Relations — verification & fixes

**Date:** 2026-06-07
**Type:** Fix

## Summary

Verified the "chat with a paper / chat across all papers / find relations between
papers" stack end-to-end against live data (10,160 academic papers, 379 with full
text, 22–34 chunked into the palace). Chat (single-paper and project-wide cited
Q&A) works end-to-end. The **paper-relations / paper-map** side was producing
**zero semantic edges** and a 14k-edge same-author hairball. Found and fixed three
real bugs so the paper map now shows weighted paper↔paper semantic relations.

## Root causes & fixes

1. **`paper_neighbors` topic filter matched zero chunks** (`retrieval/palace.py`).
   Each chunk stores a single stamped `topic` (whatever was active at chunk-time),
   but a paper belongs to many topics — so `where={"topic": topic}` silently
   matched nothing and `relates_to` collapsed to 0. Fixed by resolving topic →
   paper `post_id`s via `_paper_post_ids_for_topic` and filtering on
   `{"post_id": {"$in": ...}}` — the same fix already applied to
   `search_paper_chunks` earlier today. Also replaced a dead
   `coll.count(where=...)` guard (the `where` kwarg is unsupported on chromadb
   1.5.8 — it always threw and was swallowed) with a `coll.get(..., limit=1)`
   membership probe, restoring the zero-match-filter SEGFAULT guard.

2. **`paper_relations.build()` passed the harmful topic filter** to
   `paper_neighbors` (`research/paper_relations.py`). The `if dst in ids` guard
   already scopes neighbors to the topic's papers, so the topic filter was
   redundant *and* was killing every edge. Now queries with `topic=None`.

3. **Same-author hairball** (`research/paper_relations.py`). `_norm_author`
   treated placeholder authors like `[unknown]` (169 papers) as a real key,
   linking all 169 to each other → 14,234 spurious `same_author` edges. Added an
   `_AUTHOR_PLACEHOLDERS` blocklist; same-author edges for the test topic dropped
   from 14,234 → 38.

4. **Map node selection hid the connected papers** (`research/paper_relations.py`
   `get_paper_map`). Nodes were ranked `cites DESC`, but the chunked/embedded
   papers (which carry the relations) are recent and low-cited, so all of them
   fell below the 120-node LIMIT. Now ranks `has_chunks DESC, has_ft DESC,
   cites DESC` so the related papers always make the cut.

## Result (topic: "meditation and sound frequency brainwave app")

- Paper map: **0 → 24 semantic (`relates_to`) edges** + 11 same-author (was a
  14k hairball). Sample edges carry real similarity weights (0.76–0.80).
- Single-paper chat and project-wide cited Q&A verified working end-to-end
  against the live `nvidia/llama-3.1-8b-instruct` provider.
- 66 paper/chat/palace/relations tests pass.

## Remaining (operational, not a code bug)

Only 22–34 of 379 full-text papers (and 379 of 10,160 total) are chunked/embedded
because `run_paper_research` fetches full text + chunks only the top
`max_fulltext=3` papers per run. Chat and relations get richer as more papers are
chunked — run `openreply research paper-chunk --topic "<topic>"` (batch `chunk_topic`)
and re-fetch full text for more papers to densify both the chat corpus and the map.

## Files Modified

- `src/openreply/retrieval/palace.py` — `paper_neighbors`: topic→post_id resolution
  + working zero-match SEGFAULT guard.
- `src/openreply/research/paper_relations.py` — `build()` relates_to topic=None;
  `_norm_author` placeholder blocklist; `get_paper_map` node ordering by
  `has_chunks DESC, has_ft DESC, cites DESC`.
