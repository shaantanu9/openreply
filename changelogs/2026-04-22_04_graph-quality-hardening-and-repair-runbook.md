# Graph quality hardening + repair runbook

**Date:** 2026-04-22  
**Type:** Reliability + data-quality hardening

## Summary

This update closes the loop on the "wrong relations in topic graph" issue (example:
`meditation and sound frequency brainwave app` linking to unrelated corruption/politics
concepts) by hardening both:

1. **Future graph builds** (prevent bad links from being created), and
2. **Existing topics** (repair path to clean and rebuild already-poisoned graphs).

The fix is multi-layered:

- finding-level relevance filtering before semantic upsert,
- stricter relation edge admission in semantic linking,
- stable one-command topic repair workflow for retroactive correction.

## Root Cause

False links were produced from a combination of:

- off-topic posts getting into topic corpus,
- LLM extraction returning off-topic findings from noisy corpus slices,
- relation builder linking findings primarily via embedding similarity with no
  lexical/evidence bridge requirements for borderline pairs.

That allowed semantically loose pairs to become `relates_to`, especially when
topic corpus quality had already degraded.

## What Changed

### 1) Hardened semantic relation edge gating

**File:** `src/reddit_research/graph/relations.py`

Changes:

- Added lexical token overlap utilities:
  - `_token_set(label)`
  - `_jaccard(a, b)`
- Added a new false-link guard in `_build_relates_to(...)`:
  - For candidate pair `(a, b)`, if:
    - shared evidence posts == 0, and
    - lexical overlap < `OPENREPLY_REL_LEXICAL_FLOOR` (default `0.08`), and
    - similarity < (`OPENREPLY_REL_THRESHOLD` + `OPENREPLY_REL_BRIDGE_MARGIN`, default `+0.08`)
  - then skip edge creation.

Impact:

- Suppresses weak cross-topic bridges where embeddings are not strong enough and
  there is no corroborating evidence/lexical signal.
- Still allows genuinely strong paraphrase relations to pass when cosine is high.

Additional metadata now stamped on `relates_to` edges:

- `similarity`
- `lexical_overlap`
- `shared_evidence`

This improves post-hoc debugging and threshold tuning.

### 2) Applied finding relevance filter before graph upsert

**File:** `src/reddit_research/graph/semantic.py`

Changes in `enrich_from_llm(...)`:

- Imported and applied `filter_findings(...)` to each extracted finding bucket:
  - painpoints
  - feature_wishes
  - product_complaints
  - diy_workarounds
- Added env-tunable threshold:
  - `OPENREPLY_FINDING_REL_THRESHOLD` (default `0.45`)
- Only `kept` findings are now sent to `upsert_semantic(...)`.

Changes in `enrich_from_llm_for_posts(...)` (incremental worker path):

- Applied the same relevance filter for all four finding buckets before upsert.
- Ensures per-batch enrichment cannot reintroduce off-topic findings later.

New summary diagnostics:

- `finding_relevance_threshold`
- `dropped_off_topic_findings` (count by finding type)

Impact:

- Prevents off-topic LLM findings from becoming first-class graph nodes.
- Keeps graph cleaner even when raw corpus quality temporarily dips.

### 3) Preserved and operationalized repair workflow for existing topics

**File:** `src/reddit_research/cli/main.py` (already added in this effort)

`research repair-topic-graph` remains the canonical recovery command. It:

1. cleans topic corpus with relevance filter (`filter_topic_posts(..., apply=True)`),
2. deletes topic rows from `graph_nodes` and `graph_edges`,
3. rebuilds structural graph,
4. re-runs enrich (optional),
5. re-runs semantic relation build + source evidence backfill (optional).

This gives deterministic repair for old topics with stale bad edges.

## Operational Runbook

### A) Repair an existing topic now

```bash
uv run reddit-myind research repair-topic-graph \
  --topic "meditation and sound frequency brainwave app" \
  --relevance-threshold 0.34 \
  --min-keep 20 \
  --json
```

### B) Tuning knobs

| Env var | Default | Purpose |
|---|---:|---|
| `OPENREPLY_FINDING_REL_THRESHOLD` | 0.45 | Drops off-topic extracted findings before upsert |
| `OPENREPLY_REL_THRESHOLD` | 0.55 | Base semantic similarity threshold for `relates_to` |
| `OPENREPLY_REL_LEXICAL_FLOOR` | 0.08 | Minimum token overlap for weakly-evidenced pairs |
| `OPENREPLY_REL_BRIDGE_MARGIN` | 0.08 | Extra cosine required when lexical/evidence bridge is absent |
| `OPENREPLY_REL_MAX_NEIGHBORS` | 8 | Per-node fanout cap to avoid map hairballing |

### C) Quick verification checklist

1. Run repair command for target topic.
2. Open topic map and inspect top connected painpoints/workarounds.
3. Confirm no obvious cross-domain outliers (politics/news/legal corruption terms).
4. Trigger an incremental enrichment cycle and verify bad findings do not reappear.
5. Validate relation density is still meaningful (not over-pruned).

## Validation Performed

- Python compile sanity:
  - `python -m compileall src/reddit_research/graph/relations.py src/reddit_research/graph/semantic.py src/reddit_research/cli/main.py`
- Lint check on changed files:
  - no diagnostics.

## Files Modified

- `src/reddit_research/graph/relations.py`
- `src/reddit_research/graph/semantic.py`

## Notes for future follow-up

- Optional next step: add topic-specific auto-calibration for relation/finding thresholds
  based on per-topic similarity distributions (to reduce manual tuning).
