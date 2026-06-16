# Wire Missing Per-Source MCP Fetch Tools + Source-Wiring Audit

**Date:** 2026-06-13
**Type:** Fix

## Summary

Audited the full 64-source wiring matrix (modules → `__init__` → `collect_adapter.SOURCES`
→ MCP → CLI) to confirm that searching and adding work end-to-end after the recent
multi-source additions. Adding (collect) was fully wired for every source; the gap
was 11 sources collectable in bulk but missing a standalone per-source MCP `gapmap_fetch_*`
preview tool. Added those 11 tools so ad-hoc fetch works for them too. Also corrected the
architecture doc, which described the collector convention as `collect_<name>` when the
real convention is `run_<name>` + the `SOURCES` dispatch dict.

## Changes

- Added 11 `@mcp.tool() gapmap_fetch_*` wrappers in `mcp/server.py` (after
  `gapmap_fetch_acled`): `polymarket, truthsocial, digg, tiktok, instagram, threads,
  pinterest, x, steam, dblp, europepmc`. Each mirrors the existing thin-wrapper pattern
  (lazy import → call `fetch_<name>`), with the source's auth requirement in the docstring.
- Verified server imports clean and all 11 tools register (51 `gapmap_fetch_*` total).
- Smoke-tested `fetch_arxiv` (3 rows, valid posts-shape, citations in `score`) and
  `SOURCES` dispatch for all 8 new social sources.
- Corrected `docs/specs/PAPER_RESEARCH_ARCHITECTURE.md`: collector convention is
  `run_<name>` + `SOURCES` dict (not `collect_<name>`); updated the directory map,
  the "add ONE new source" recipe, and acceptance criteria. Added a §12 wiring-audit
  status section.
- Flagged a pre-existing duplicate `gapmap_paper_citations` definition
  (`mcp/server.py:899` and `:1514`) for follow-up.

## Files Created

- `changelogs/2026-06-13_08_wire-missing-mcp-fetch-tools.md`

## Files Modified

- `src/gapmap/mcp/server.py` — added 11 per-source MCP fetch tools.
- `docs/specs/PAPER_RESEARCH_ARCHITECTURE.md` — corrected collector convention + audit section.
