# Idea Scan — backend orchestrator + CLI (phase 1+2 of 5)

**Date:** 2026-05-01
**Type:** Feature

## Summary

First half of the "2-word seed → top 5 wedges in ~2 minutes" feature.
Adds the SQLite migration, the parallel fan-out orchestrator, the cluster
+ LLM-synthesis pass, and the CLI surface that the upcoming Tauri command
layer will call. Halts the fetch the moment combined item count crosses
200 (configurable). Cluster labelling honours the user's chosen LLM (or
falls back to deterministic keyword-bag labels when none is configured).
No frontend work yet — that's phases 3–5. Pausing here so the corpus
quality of a real scan can be sanity-checked before building UI on top.

## Changes

- **Schema migration** — new `idea_scans` table inside
  `_ensure_lifecycle_schema` (additive + idempotent, no breaking change
  for existing installs). Stores: seed, canonical search topic, status
  (`pending|fetching|halted|completed|synthesizing|ready|error`), halt
  threshold, total items, sources planned/hit/pending JSON, clusters
  JSON, resolved LLM provider + model, error message, and four
  timestamps.
- **Orchestrator** — `src/reddit_research/research/idea_scan.py`. Public
  surface: `start_scan`, `synthesize_scan`, `get_scan`, `list_scans`,
  `extend_scan`.
  - `DEFAULT_SOURCES` covers 17 adapters that don't need explicit
    config (HN, AppStore, PlayStore, Trustpilot, ProductHunt, Bluesky,
    arXiv, OpenAlex, PubMed, GitHub trending, Wikipedia, Dev.to, Stack
    Overflow, gnews, AlternativeTo, RSS bundles).
  - `ThreadPoolExecutor(max_workers=8)` — same parallelism pattern as
    `collect.py`. We don't cancel in-flight workers on halt — they run
    to completion to avoid leaking partial state.
  - `_run_one_source` uses each adapter's existing return contract and
    pulls a recent-id sample from `posts` (LIKE-prefix matched on
    `source`) to tag into `topic_posts` under a synthetic
    `_idea::<scan_id>` topic key. The synthesis pass reads the corpus
    back via that key.
  - `_expand_keywords` reuses `_canonicalize_topic` so a 2-word seed
    gets spell-corrected + LLM-scored search keywords. Fallback path
    uses `_fallback_keyword_candidates` so the orchestrator still
    produces 5+ query variants on no-LLM machines.
- **Synthesis** — `synthesize_scan`:
  - `_embed_titles` calls the shared `retrieval.embedder.get_embedding_function`
    (MiniLM ONNX, ~80 MB cached). Returns `None` → `_greedy_cluster`
    falls back to a deterministic Jaccard-on-token-bags pass so we still
    cluster on machines without chromadb.
  - Greedy cosine clustering with running-centroid (O(n·k), k stays
    small) instead of pulling in HDBSCAN.
  - Guest et al. (2006) floor — clusters with `<8 mentions` or `<2
    sources` are dropped before LLM labelling. Surfaces 3 strong
    wedges over 5 noisy ones.
  - `_llm_label_cluster` returns a `(label, jtbd)` pair via tolerant
    JSON extraction — accepts code-fenced or raw JSON, falls back to
    most-frequent-token labels on parse failure or no-LLM mode.
- **CLI commands** — five new subcommands on `research_app`:
  - `research idea-start --seed "ats resume" [--sources hn,appstore,…] [--provider anthropic] [--halt-threshold 200] [--max-seconds 120] --json`
  - `research idea-synthesize --scan-id <id> --json`
  - `research idea-get --scan-id <id> --json`
  - `research idea-list --limit 50 --json`
  - `research idea-extend --scan-id <id> --json`
  - `start` and `extend` stream progress as JSONL (`{"event":"progress","message":"…"}`)
    so the Tauri streaming bridge can pipe them straight into the live
    counter modal once the frontend lands.

## Files Created

- `src/reddit_research/research/idea_scan.py` — orchestrator, clustering,
  synthesis, persistence helpers.
- `changelogs/2026-05-01_11_idea-scan-backend-phase-1-2.md` — this file.

## Files Modified

- `src/reddit_research/core/db.py` — added the `idea_scans` table inside
  `_ensure_lifecycle_schema` (no impact on existing tables).
- `src/reddit_research/cli/main.py` — five new `@research_app.command`
  entries.

## Sanity check

Run a real scan to verify corpus quality before the frontend lands:

```bash
reddit-cli research idea-start --seed "ats resume" --provider anthropic --json | tail
reddit-cli research idea-synthesize --scan-id <id from above> --json | jq '.clusters'
```

Expected: 3–5 cluster summaries with `label`, `jtbd`, `mention_count`,
`source_count`, and `sample_quotes` populated. `mention_count` should
sum to ≥ ~120 across surviving clusters (Guest 2006 floor drops the
weakest 30–40% by design).

## Next phases

- Phase 3 — Tauri commands wrapping the four CLI calls (mirror the
  `run_empathy_build` / `empathy_get` pattern in `commands.rs`)
- Phase 4 — Frontend `#/idea` screen (seed modal → live counter →
  decision modal with three buttons per cluster)
- Phase 5 — Sidebar entry between Search and Find + Settings hook for
  the default scan LLM
