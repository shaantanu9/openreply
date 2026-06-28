# Research Mode — user/dev guide doc

**Date:** 2026-06-07
**Type:** Documentation

## Summary

Added `docs/RESEARCH-MODE.md` — a concise guide to the research workspace:
how to enable App Mode, the Gather→Read→Synthesize→Write daily loop, the
additive tables, the full CLI/MCP surface, tests, and known P2 gaps. Pairs with
FEATURES.md §19 and the design spec.

## Integration check (this session's research-mode work vs. parallel edits)

Verified on the current tree (which includes in-progress parallel edits to
main.rs/commands.rs/workflows): all 14 research-mode Tauri commands still
registered, Python modules import, 20 unit tests pass, `cargo check` clean.

## Files Created
- `docs/RESEARCH-MODE.md`, `changelogs/2026-06-07_15_research-mode-guide-doc.md`
