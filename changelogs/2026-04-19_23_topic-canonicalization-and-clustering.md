# Topic canonicalization + emergent theme clustering

**Date:** 2026-04-19
**Type:** Feature + Fix

## Summary

Closes the "wrong-corpus" failure mode where a typo (e.g. "calari tracking app")
silently routed through to flight-tracking subs and aviation research papers
instead of calorie tracking. Adds LLM-backed topic canonicalization at the
top of the collect pipeline so every downstream source (Reddit subs, Reddit
search, arXiv, OpenAlex, PubMed, HN, Scholar, Dev.to, App Store, Play Store,
Stack Overflow, GitHub, Google News, Google Trends) uses the corrected form.
Also ships emergent theme clustering: near-duplicate findings merge into one
card with a "+N variants" pill instead of cluttering the sidebar with
near-identical painpoints.

## Changes

### Topic canonicalization (A)
- `src/reddit_research/research/discover.py` — new `_canonicalize_topic`
  helper. LLM call (uses the configured provider, ~100 tokens each way,
  temperature 0.1) returns `{canonical, variants, confidence}`. Result
  cached in `topic_canonicalizations` SQLite table (pk = lowercased original
  topic) so repeated calls don't re-hit the LLM.
- `_canonicalize_topic` never raises. LLM parse failures, missing chromadb,
  missing provider — all degrade to passthrough with `confidence="unknown"`.
- JSON parse tries three strategies: raw, fence-stripped, first `{...}`
  block via regex. Handles markdown-wrapped and prose-embedded responses.
- `discover_subs` now returns `{subs, confirmation}` instead of `list[dict]`.
  Confirmation carries `original_topic`, `canonical_topic`, `auto_corrected`,
  `needs_confirmation`, `suggested_variants`, `reason`.
- Four discover_subs callers updated in lockstep: `research/collect.py`,
  `cli/main.py`, `mcp/server.py` (kept MCP `list[dict]` contract stable),
  and the Rust command passes the `Value` through unchanged.

### Collect-level canonicalization (NEW — multi-source fix)
- `research/collect.py` now calls `_canonicalize_topic` once at the top of
  `collect()`. The resolved canonical drives every downstream fetch and
  search — not just Reddit sub discovery, but arXiv, OpenAlex, PubMed,
  HN, Scholar, and all source adapters in `sources/collect_adapter.py`.
- Storage (`_tag_posts`) also uses the canonical so the corpus isn't split
  between typo and corrected form.
- `CollectResult.topic` is updated to the canonical. Original is preserved
  in `result.errors` as an info line for observability.

### Emergent theme clustering
- `src/reddit_research/retrieval/cluster.py` — new module. `cluster_findings`
  embeds finding labels via chromadb's built-in ONNX embedder, runs greedy
  union-find clustering at cosine similarity ≥ threshold (default 0.82,
  overridable via `GAPMAP_CLUSTER_THRESHOLD`). Near-duplicates collapse to
  one winner (highest frequency + longest evidence); other labels attach
  as `aliases`.
- Evidence post IDs merge across the cluster (de-duped) so saturation stays
  accurate.
- `graph/semantic.py::upsert_semantic` runs clustering before persisting.
  Each finding kind propagates `aliases` into `metadata_json`.
- `graph/export.py` renders a `+N variants` lavender pill on merged findings;
  hover tooltip lists the merged labels.

### Frontend (typo correction UX)
- `app-tauri/src/lib/topicConfirm.js` (new) — `showCorrectionToast` + 
  `showTopicConfirmModal` helpers. Toast auto-dismisses after 10 s;
  modal blocks with variants + "Keep as-is" option.
- `app-tauri/src/main.js` — new-topic flow now calls `api.discoverSubs`
  before dispatching `gapmap:start-collect`. High-confidence correction
  → toast; low-confidence / weak sub relevance → blocking modal.
- `app-tauri/src/style.css` — styles for the toast + modal.

## Files Created

- `src/reddit_research/research/discover.py` — `_canonicalize_topic`,
  `_load_canonical`, `_cache_canonical`, `_llm_canonical_call` (all new
  functions in an existing module).
- `src/reddit_research/retrieval/cluster.py` — `cluster_findings` and helpers.
- `app-tauri/src/lib/topicConfirm.js` — UI helpers.
- `docs/superpowers/specs/2026-04-19-topic-canonicalization-design.md` — spec.
- `docs/superpowers/plans/2026-04-19-topic-canonicalization.md` — plan.
- `docs/superpowers/specs/2026-04-19-quick-wins-sprint-design.md` — follow-up
  spec for the remaining Parts B + C.
- `docs/superpowers/plans/2026-04-19-quick-wins-sprint.md` — follow-up plan.

## Files Modified

- `src/reddit_research/core/db.py` — added `topic_canonicalizations` table to
  `init_schema`.
- `src/reddit_research/research/discover.py` — `discover_subs` return-shape
  change, canonicalization wired in.
- `src/reddit_research/research/collect.py` — canonicalize at top; use
  canonical for every search + storage call.
- `src/reddit_research/cli/main.py` — CLI command unwraps new shape, surfaces
  auto-correction + weak-match warnings on stderr.
- `src/reddit_research/mcp/server.py` — MCP tool still returns `list[dict]`
  (unwraps the new shape internally).
- `src/reddit_research/graph/semantic.py` — clustering call + `aliases`
  metadata propagation for each finding kind.
- `src/reddit_research/graph/export.py` — `+N variants` pill rendering +
  CSS rule.
- `app-tauri/src/main.js` — new-topic flow canonicalization gate.
- `app-tauri/src/style.css` — toast + modal styles.
- `tests/test_integration.py` — 10 new tests: 4 canonicalization,
  3 discover-shape, 3 cluster.

## Commits (in order)

- `302dc20` feat(db): add topic_canonicalizations table
- `7d475ec` test(discover): failing canonicalization tests
- `8514e45` feat(discover): LLM canonicalize + cache
- `ba67011` refactor(discover): harden parsing + cache guards
- `bd558ae` test(discover): failing discover_subs shape tests
- `6221e04` refactor(discover): return `{subs, confirmation}`
- `1bd4b16` fix(callers): unwrap new shape in 3 Python callers
- `537aa1c` feat(ui): correction toast + confirmation modal
- `4589032` docs(spec): mark shipped
- `bddac8d` feat(cluster): emergent theme clustering via ONNX
- `768f04b` fix(collect): canonicalize once at top — applies to ALL sources
