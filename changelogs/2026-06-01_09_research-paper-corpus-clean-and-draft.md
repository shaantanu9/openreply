# Research-paper corpus clean + draft for "meditation and sound frequency brainwave app"

**Date:** 2026-06-01
**Type:** Infrastructure (data) + Documentation

## Summary

Walked the research-paper collection flow end-to-end for the topic
*meditation and sound frequency brainwave app* and produced a clean,
citable paper workspace. The topic's corpus was contaminated (64% of
tagged social posts were off-topic — Disney+, law-enforcement, censorship
noise — which had poisoned the LLM-extracted graph findings). Cleaned the
corpus, preserved the full academic-paper base, regenerated on-topic
findings, and generated an outline + IMRaD draft + citation appendix +
literature review.

No source code was modified — all changes are to the openreply SQLite data
(`~/Library/Application Support/com.shantanu.openreply/openreply/openreply.db`) and
new output files under `paper_meditation_brainwave/`.

## Changes

- **Cleaned corpus:** `research clean-corpus --threshold 0.40 --apply`
  dropped 4,188 off-topic posts (5,721 → 1,533). Must be run in the
  **foreground** — background runs were killed at turn boundaries; two
  concurrent heavy ops also deadlocked on the SQLite write lock.
- **Restored academic papers:** strict 0.40 also dropped 367 of 528 papers
  (cosine to the topic string < 0.40). Re-linked those 367 papers from the
  pre-clean backup (`openreply.db.backup_premerge_20260601`) into
  `topic_posts`, restoring the full 528-paper base while keeping the social
  corpus clean. Final corpus: 1,900 posts (528 papers + ~1,372 clean social).
- **Cleared contaminated graph findings:** deleted off-topic semantic
  `graph_nodes`/`graph_edges` (painpoint/intervention/mechanism/concept/
  temporal_gap/era/product/…) so `synthesize_insights` would not re-inject
  them via its top-20-nodes prompt block. Kept structural + evidence_paper
  nodes.
- **Regenerated insights:** `research insights --chunked --max-workers 1`
  (sequential paced LLM calls) produced 55 clean meditation findings in
  ~70s with no 429. Chunked mode is the workaround for the rate-limited free
  NVIDIA `meta/llama-3.3-70b-instruct` provider (the only one configured).
- **Analyzed papers:** `research analyze-papers` in paced batches of 30–40
  → 146 of 528 papers now have LLM summary/relevance/takeaway in
  `paper_analyses`.
- **Generated paper artifacts:** outline, IMRaD draft + citation appendix,
  literature review, and findings files.

## Files Created

- `paper_meditation_brainwave/outline.json` — 9-section IMRaD outline.
- `paper_meditation_brainwave/draft_with_citations.md` — IMRaD draft +
  citation appendix (1,664 research sources).
- `paper_meditation_brainwave/export_meta.json` — raw paper-export payload.
- `paper_meditation_brainwave/literature_review.md` — 146 analyzed papers,
  ranked, each with summary/relevance/takeaway.
- `paper_meditation_brainwave/findings.md` — 55 clean on-topic findings
  with opportunity scores.
- `changelogs/2026-06-01_09_research-paper-corpus-clean-and-draft.md`

## Files Modified

- openreply SQLite data only (`topic_posts`, `graph_nodes`, `graph_edges`,
  `topic_insights`, `paper_analyses`). No repository source files changed.

## Gotchas discovered (for future sessions)

- Long openreply embedding ops (clean-corpus / repair / reindex over thousands
  of posts) take **minutes** and MUST run in the foreground with a long
  `timeout`; backgrounded runs were killed at turn boundaries and silently
  rolled back (SQLite WAL kept the DB safe).
- Never run two mutating `research` ops on the same topic concurrently —
  they deadlock on the DB write lock and neither commits.
- `clean-corpus --threshold 0.40` is aggressive on **papers** (specific
  topic strings push genuine papers below 0.40). Snapshot/restore paper
  links from the pre-op backup if a full literature base is wanted.
- The free NVIDIA tier 429s on bursty calls; `--chunked --max-workers 1`
  (insights) and small `--limit` batches (analyze-papers) pace under it.
- `paper-draft`/`paper-outline` read the `topic_insights` synthesis report
  (not `graph_nodes` painpoints directly), but `synthesize_insights` injects
  the top-20 graph nodes into its prompt — clear contaminated finding nodes
  before regenerating.
