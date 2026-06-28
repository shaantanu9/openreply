# Fix Duplicate MCP Paper-Citation Tool + Full Build/Run Verify + Working Paper

**Date:** 2026-06-14
**Type:** Fix | Documentation

## Summary

Analyzed the full app state, fixed a real bug in the paper-research MCP surface,
verified the whole desktop stack builds and runs, and wrote an academic working
paper documenting the system. The bug: `openreply_paper_citations` was defined
twice in `mcp/server.py` with different semantics (single-paper forward
citations vs. topic-wide citation-graph build), so FastMCP logged
`Component already exists: tool:openreply_paper_citations` and the second
registration silently shadowed the first — leaving the documented single-paper
tool unreachable. Renamed the topic-wide builder to `openreply_paper_citation_graph`
so both tools register and work. Verified end-to-end: backend tests (314 pass),
paper/MCP subset (37 pass), frontend build + tests (52 pass), Rust build
(0 errors), bundled-sidecar health probe (ok), and a live `tauri dev` launch
(window up, stable).

## Changes

- Renamed the topic-wide citation-graph MCP tool from the colliding
  `openreply_paper_citations(topic, limit)` to `openreply_paper_citation_graph`
  (`mcp/server.py:1610`). The single-paper `openreply_paper_citations(paper_id, limit)`
  (`server.py:995`) keeps its documented name. Server now imports with zero
  duplicate-component warnings.
- Updated `MCP_TOOLS.md` with a documented entry for `openreply_paper_citation_graph`.
- Corrected `docs/specs/PAPER_RESEARCH_ARCHITECTURE.md`: fixed stale line
  citations for the citation-graph tools (995/1005/1610/1627/1654/1669) and
  changed the "known pre-existing issue" note to a "Resolved (2026-06-14)" note.
- Wrote an academic working paper (`docs/papers/2026-06-14_openreply-working-paper.md`)
  covering the unified evidence contract, multi-source acquisition, the
  paper-research subsystem, the FSD-Fleet multi-agent deliberation layer
  (governed flows L1–L3, dynamic-role debate, NL command center), the
  local-first engineering split, validation, limitations, and future work.
- Verified the uncommitted fleet/debate/governance WIP is coherent and wired:
  `run_fleet_flow(topic, route, rounds, level, approved, on_stage)`,
  `run_topic_debate(topic, rounds, provider, dynamic_roles)`, and the new
  `research fleet-command` NL command center all import and parse cleanly.

## Files Created

- `changelogs/2026-06-14_09_paper-citation-tool-dedup-and-working-paper.md`
- `docs/papers/2026-06-14_openreply-working-paper.md`

## Files Modified

- `src/openreply/mcp/server.py` — renamed colliding `openreply_paper_citations`
  topic-builder to `openreply_paper_citation_graph`.
- `MCP_TOOLS.md` — added `openreply_paper_citation_graph` doc entry.
- `docs/specs/PAPER_RESEARCH_ARCHITECTURE.md` — fixed citation-tool line refs
  and marked the duplicate-tool issue resolved.

## Verification

- `pytest tests/` → 314 passed, 1 failed (live-network only), 2 skipped.
- `pytest -k "paper or citation or mcp"` → 37 passed.
- `npm run build` → success; `npm test` → 52 passed.
- `cargo build` → 0 errors.
- Bundled sidecar `health --json` → `ok: True` (all subsystems green except
  Reddit OAuth, which is info-level / non-blocking).
- `npm run tauri:dev` → app launched (vite + Rust binary running, stable).
