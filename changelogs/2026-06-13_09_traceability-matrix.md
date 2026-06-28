# 2C — Traceability Matrix (gap → its sources)

**Date:** 2026-06-13
**Type:** Feature
**Part of:** WhyBuddy port roadmap, Wave 2. Spec: `docs/superpowers/specs/2026-06-13-2C-traceability-matrix.md`. Builds on 1A's `lineage` table.

## Summary

Added a persistent, queryable **lineage-based traceability** layer: given an
artifact (graph node id), return the source posts that produced it, joined
through the `lineage` table 1A populates. Exposed as a Python helper + an MCP
tool. Best-effort / read-only.

## Honest scope note (overlap finding)

The **UI** side of "click a finding → see its source posts" **already existed**
in OpenReply before this work: each insight card renders a `📎 N evidence`
citation chip (`renderCitationChips(f.evidence_post_ids)`) with a posts
drill-down (`showCounterEvidenceModal` pattern, `:ids` post lookup). So no
redundant sources-expander UI was added — that would duplicate existing
functionality.

What was genuinely missing and is now added: a **persistent provenance record**
(the `lineage` table) and a **reusable query path** over it (helper + MCP tool),
which — unlike the per-finding `evidence_post_ids` carried on the live report
object — survives independently, is queryable programmatically, and powers
future Wave-2 items (replay 2G, dependency invalidation 2H).

## Changes (committed)
- `src/openreply/research/traceability.py` — `traceability_for_artifact(artifact_id)`:
  `lineage ⋈ json_each(from_post_ids) ⋈ posts` → source rows
  (id/title/url/permalink/source_type/author/score). `[]` on error, never raises.
- `src/openreply/mcp/server.py` — `openreply_traceability(artifact_id)` MCP tool.

## Files Created
- `src/openreply/research/traceability.py`
- `tests/test_traceability.py` (3 tests), `tests/test_mcp_traceability.py` (2 tests)

## Files Modified
- `src/openreply/mcp/server.py` (new tool)

## Not added (by design)
- A second per-finding sources-expander UI — the existing evidence citation
  chip already surfaces source posts on the card.
