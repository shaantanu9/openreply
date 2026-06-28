# Paper Abstract-Fallback Embedding — chat & relate the WHOLE library

**Date:** 2026-06-07
**Type:** Feature

## Summary

Paper chat and paper relations both ground on the `paper_chunks` palace
collection, which is fed only by **full-text** chunking. But only ~38 of 10,160
academic papers have open-access full text (the rest are `not_oa` / paywalled),
so the chat corpus and relations map were starved — ~22–34 papers. This change
adds an **abstract-level fallback**: every paper that has a title+abstract but no
full text gets its abstract embedded as a single `section="abstract"` chunk into
the same collection. Result: the whole library (~6k abstract-bearing papers)
becomes chat-able (`paper_qa`) and relatable (`paper_neighbors` → `relates_to`),
with zero network calls — abstracts are already in `posts.selftext`.

## Impact

Library-wide backfill (`chunk_abstracts_all(None)`): **6,312 candidates → 5,989
embedded, 0 errors**. Distinct papers embedded in the palace: **22 → 6,320**
(287×). After rebuilding relations, every active topic's paper map went from
0–14 edges to hundreds/thousands of weighted semantic edges, e.g.:

| Topic | Map edges (semantic) |
|---|---|
| meditation and sound frequency | 996 (978) |
| public speaking anxiety app | 1,005 (996) |
| brainwave meditation (relax/focus) | 1,015 (997) |
| ocr and table data image to text | 1,075 (1,056) |
| public speaking communication | 395 (381) |
| Indian student exam stress | 631 (622) |
| app onboarding psychology | 172 (168) |

Per-topic chunk coverage is now 60–80% (remainder = title-only papers with no
abstract text, which need metadata enrichment). Paywalled / abstract-only papers
are now answerable in chat (verified live).

## Changes

- New `chunk_paper_abstract(post_id)` — embeds a paper's title+abstract as one
  `abstract` chunk. Idempotent, local-CPU, with a 1-retry embed and a
  **heal-on-rerun** guard (skips only when the row's hash matches AND
  `embedded_at` is set, so rows stranded by a failed embed get re-embedded).
- New `chunk_abstracts_all(topic=None)` — batch backfill; skips papers that
  already have full-text chunks (those are richer).
- Pipeline integration so future runs cover the whole corpus automatically:
  - `paper_pipeline.run_paper_research` — new step 3c abstract-chunks the topic
    after full-text chunking; reports `abstracts_chunked`.
  - `paper_workflow.build_paper_knowledge` (the app's "Build knowledge" button)
    — new **"embed"** stage between full-text and relations, so the relations
    build sees every paper's vector.
- CLI: `openreply research paper-chunk --abstracts [--topic …]` to backfill on
  demand (whole library when `--topic` is omitted).

## Why abstract chunks "just work" downstream (no retrieval changes)

- `search_paper_chunks` already filters by `post_id ∈ topic` (the 2026-06-07
  topic→post_ids fix), so abstract chunks are retrieved with no topic stamp.
- `paper_chat._NOISE_SECTIONS` does NOT drop `abstract`, so abstract chunks are
  used for grounding.
- `paper_neighbors` mean-pools ALL of a paper's chunks, so a lone abstract chunk
  is enough to give a paper semantic neighbors.

## Files Created

- (none)

## Files Modified

- `src/openreply/research/paper_chunks.py` — `_load_abstract`,
  `chunk_paper_abstract`, `chunk_abstracts_all`, retry + heal-on-rerun, `__all__`.
- `src/openreply/research/paper_pipeline.py` — step 3c + `abstracts_chunked` in the
  return payload.
- `src/openreply/research/paper_workflow.py` — new `embed` stage in the
  build-knowledge orchestrator.
- `src/openreply/cli/main.py` — `--abstracts` flag on `research paper-chunk`.
