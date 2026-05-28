# Port graphify patterns into gapmap-graph (additive)

**Date:** 2026-05-28
**Type:** Feature + Infrastructure

## Summary

Ported the high-value patterns from the external `graphify` tool
(`/Users/shantanubombatkar/Documents/GitHub/graphify`) into our own
`src/gapmap/graph/` builder without removing or replacing anything.

The goal: better connections, better conclusions, better UI — produced by
adding new artifacts (community labels, edge provenance, markdown audit,
cost ledger, three insight lenses) on top of the existing structural +
semantic + relations pipeline. Every existing command behaves the same.

Verified end-to-end against `AI coding assistants` (5,633 nodes, 12,254
edges): communities collapse from 2,745 raw → 24 meaningful; confidence
backfill tags 12,216 EXTRACTED / 37 INFERRED / 1 AMBIGUOUS; report
renders all eight sections; D3 viewer shows new lens controls.

## Changes

### Edge confidence (graphify EXTRACTED / INFERRED / AMBIGUOUS)
- `_upsert_edge` in `build.py` accepts a `confidence=` kwarg that lands
  inside `metadata_json` (no schema change).
- `_BatchState` now carries `default_confidence`; `build_structural`
  sets it to `EXTRACTED` for the duration so every structural edge gets
  tagged without touching 12 call sites.
- `upsert_semantic` and `backfill_source_evidence` wrap their bodies the
  same way with `INFERRED`.
- `relations.py` tags `relates_to` as `INFERRED` when corroborated by
  shared evidence or lexical overlap, else `AMBIGUOUS`; `co_evidenced`,
  `potentially_solves`, `could_address` are explicitly `INFERRED`.

### Community detection (Leiden + Louvain fallback)
- New `graph/communities.py` with `detect_communities_leiden(topic)`.
- Tries graspologic Leiden first; falls back to networkx
  `louvain_communities` when graspologic isn't installed.
- Defaults tuned for sparse social graphs (resolution=0.5, hub_percentile
  =100, min_community_size=3) — verified that defaults turn ~2.7K raw
  communities into ~24 meaningful ones on a 5.6K-node topic.
- Persists `community_id` and `community_size` into `graph_nodes.metadata_json`
  via `json_patch` — no schema change.

### Insight queries (read-only analytics)
- New `graph/insights.py` with four pure-read functions:
  - `surprising_connections(topic)` — edges across community boundaries
  - `knowledge_gaps(topic)` — painpoints with zero solver candidate
  - `cross_source_bridges(topic)` — findings triangulated across ≥3 sources
  - `god_nodes(topic)` — top-degree nodes filtered to semantic kinds
- One-shot `backfill_edge_confidence(topic)` for retroactively tagging
  rows written before the inline stamping landed.

### GRAPH_REPORT.md emission
- New `graph/report.py` with `render_report(topic)` and `emit_report(topic, out_dir)`.
- Eight sections, mirrors graphify's `report.py`:
  corpus check · edge confidence breakdown · god nodes · communities ·
  surprising connections · knowledge gaps · cross-source bridges · cost.
- Writes to `graphify-out/GRAPH_REPORT_<topic>.md` by default.

### Cost ledger
- New `graph/cost.py` — append-only JSONL at `data/cost/<topic>.jsonl`.
- Per-call records: `{ts, topic, provider, model, op, input_tokens,
  output_tokens, est_usd, unknown_pricing, meta}`.
- `estimate_usd(model, in, out)` covers Claude (Opus 4.6/4.7,
  Sonnet 4.5/4.6, Haiku 4.5), OpenAI (GPT-4o, 4o-mini), Gemini (2.0/2.5
  flash/pro), Kimi K2.6, DeepSeek v3/v4-flash, Ollama (free).
- Hooked into `enrich_from_llm` post-success — best-effort, never blocks.

### D3 viewer upgrade (additive only)
- `export_graph_json` now emits `metadata.confidence` per link and
  `meta.edge_confidence` / `meta.community_sizes` per topic.
- New CSS classes color edges by confidence (solid / dashed / dotted+faded)
  and highlight cross-community "surprising" edges in orange.
- New right-rail controls (`.lenses`) below the existing Reset/Show-users:
  - **Search box** — dims non-matching nodes by label substring
  - **⚡ Surprising** — highlights cross-community edges + endpoints
  - **🕳 Gaps** — highlights painpoints with no solver candidate
  - **🌉 Bridges** — highlights findings with ≥3 source kinds
  - **⊕ All edges** — cycles confidence filter (All → INFERRED → EXTRACTED → AMBIGUOUS)
  - **🎨 Communities** — toggles per-node community-color outer ring
- Per-node `_isGap`, `_isBridge`, `_communityId` precomputed in JS so
  toggles are instant (no fetch).
- Existing legend gets an additional row with confidence dash-pattern
  swatches and community count.

### NFKC node ID normalization
- `make_node_id(topic, kind, key)` now NFKC-folds `key` so combining-form
  and precomposed unicode (e.g. two ways to write "Café") hash to the
  same node. Verified: `make_node_id('t','p','Café')` == both forms.
- No-op for ASCII keys — doesn't change any existing IDs in practice.

### Backup-on-destructive-edit
- `research repair-topic-graph` now snapshots the topic's nodes + edges
  to `data/backups/<topic-slug>_<ts>.json` before the DELETE.
- Default on; `--no-backup` opt-out.
- Best-effort: a backup failure prints a warning but doesn't abort the
  destructive operation the user explicitly requested.

### CLI commands added under `gapmap research graph`
- `communities` — Leiden detection + persist community_id
- `report` — emit GRAPH_REPORT.md for a topic
- `insights` — JSON dump of `--section all|surprising|gaps|bridges|god`
- `cost` — show cost ledger summary
- `backfill-confidence` — tag pre-existing edges by kind

### Existing-behavior guarantees
- No schema changes (everything in `metadata_json`).
- No existing CLI command altered.
- `analyze.detect_communities` (the older Louvain summary helper) kept.
- D3 viewer behaves identically when no community / confidence data exists.
- All new optional deps gracefully skip when missing (graspologic →
  Louvain; ChromaDB → no dense relations; networkx → no clustering).

## Files Created

- `src/gapmap/graph/communities.py`
- `src/gapmap/graph/insights.py`
- `src/gapmap/graph/report.py`
- `src/gapmap/graph/cost.py`
- `changelogs/2026-05-28_01_graphify-patterns-port.md`

## Files Modified

- `src/gapmap/graph/__init__.py` — export 11 new symbols (no removals)
- `src/gapmap/graph/schema.py` — NFKC normalization in `make_node_id`
- `src/gapmap/graph/build.py` — `confidence` kwarg + `_BATCH.default_confidence`
- `src/gapmap/graph/semantic.py` — wrap `upsert_semantic` /
  `backfill_source_evidence` with `default_confidence="INFERRED"`; hook
  cost logger after `enrich_from_llm` success
- `src/gapmap/graph/relations.py` — tag `relates_to`, `potentially_solves`,
  `could_address`, `co_evidenced` with explicit confidence
- `src/gapmap/graph/export.py` — emit link metadata + confidence /
  community counts in meta; add lens controls + CSS + JS to HTML viewer
- `src/gapmap/cli/main.py` — register `communities`, `report`, `insights`,
  `cost`, `backfill-confidence` subcommands; add `_snapshot_topic_graph`
  helper + `--backup/--no-backup` flag to `repair-topic-graph`

## How to use

```bash
# 1. One-shot: tag every existing edge with confidence
gapmap research graph backfill-confidence --topic "<your topic>"

# 2. Compute communities (required for the surprising-connections lens
#    and the Communities section in the report)
gapmap research graph communities --topic "<your topic>"

# 3. Render the markdown audit
gapmap research graph report --topic "<your topic>"
# → graphify-out/GRAPH_REPORT_<slug>.md

# 4. Inspect insights as JSON
gapmap research graph insights --topic "<your topic>" --section all --limit 10

# 5. Cost summary
gapmap research graph cost --topic "<your topic>"

# 6. Re-export the HTML viewer to pick up community color + new lenses
gapmap research graph export --topic "<your topic>" --format html
# → open the file; click ⚡ Surprising / 🕳 Gaps / 🌉 Bridges / 🎨 Communities
```
