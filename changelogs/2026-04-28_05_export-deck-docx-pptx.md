# Stakeholder-Ready DOCX + PPTX Export (research export-deck)

**Date:** 2026-04-28
**Type:** Feature

## Summary

Added DOCX and PPTX export to the research pipeline so the same corpus that drives the markdown brief can be turned into a Word document or a pitch deck without leaving the CLI. Exposed both formats as MCP tools (`reddit_export_docx`, `reddit_export_pptx`) and as a CLI command (`reddit-cli research export-deck`).

Picked **`python-docx`** + **`python-pptx`** because both are pure-Python, zero system deps (no LibreOffice / no Cairo), MIT-licensed, ~5 MB each, and produce real Office Open XML that opens in Word, Pages, Google Docs, Keynote, PowerPoint, LibreOffice without rendering surprises. PDF was deliberately not bundled — `docx2pdf` needs Word/LibreOffice on the host and `weasyprint` needs Cairo/Pango; users who need PDF can Save-as from the .docx in 2 clicks.

Both new tools degrade gracefully when the optional deps aren't installed: instead of raising on import, they return `{ok: False, error, install_hint}` so the MCP client can tell the user exactly what to `pip install`.

The smoke-test on the home-improvement-lending corpus produced a 41 KB DOCX (12 painpoints, citation-grounded) and a 44 KB PPTX (16 slides) from 2,030 deduplicated posts merged across 6 sibling topics.

## Changes

- New `_gather_deck_data()` reads from the same tables the markdown exporter already reads (`topic_insights`, `posts`, `topic_posts`, `graph_nodes`) so the three formats never drift
- DOCX layout: cover · executive summary · corpus stats · 12 painpoints with cited evidence + score table per painpoint · competitor teardown table (reviews / avg ★ / 1★ rate) · voice-of-customer (top 8 engagement quotes) · re-pull instructions
- PPTX layout: cover · TL;DR · corpus snapshot · top market quote · one slide per top painpoint with cited evidence · competitor matrix · 3 customer quotes · top opportunities · re-pull instructions
- `extra_topics` parameter on both renderers — merge sibling topics into the corpus without re-collecting
- New `[docs]` extra in `pyproject.toml`; `[all]` now includes `docs`
- Two new MCP tools registered in `server.py` (`reddit_export_docx`, `reddit_export_pptx`)
- New Typer command `reddit-cli research export-deck --format docx|pptx|md-to-docx`
- New `build_docx_from_markdown()` — pandoc-backed markdown → DOCX with full GFM-table / blockquote / fenced-code / inline-formatting fidelity. Falls back to a hand-rolled python-docx renderer if pandoc isn't on the host. Fixes the original DOCX shell that only carried the painpoint *labels* — the new converter carries the full citation tables, evidence quotes, and competitor matrices straight from the rich markdown brief.
- New MCP tool `reddit_export_docx_from_markdown(md_path, out_path, reference_docx?)`
- Added `pypandoc-binary>=1.13` to the `[docs]` extra so end users get a bundled pandoc binary (~25 MB) without a separate install
- Re-converted `2026-04-28_lending-marketplace-deep-dive.md` (60.6 KB markdown) → `.docx` (43.6 KB) — verified with python-docx: 164 paragraphs, 40 tables, all 14 painpoints with their evidence-quote tables intact, all heading levels preserved.

## Files Created

- `src/reddit_research/research/export_deck.py` — single module with `build_docx()` + `build_pptx()` + shared `_gather_deck_data()` data layer
- `docs/research/2026-04-28_lending-marketplace-deck.docx` — smoke-test artifact (41 KB, 12 painpoints, 10 competitors, 2,030 corpus posts)
- `docs/research/2026-04-28_lending-marketplace-deck.pptx` — smoke-test artifact (44 KB, 16 slides)
- `changelogs/2026-04-28_05_export-deck-docx-pptx.md` — this changelog

## Files Modified

- `src/reddit_research/mcp/server.py` — added `reddit_export_docx` + `reddit_export_pptx` MCP tools
- `src/reddit_research/cli/main.py` — added `cmd_export_deck` Typer command
- `pyproject.toml` — added `[docs]` optional-extra (`python-docx>=1.1`, `python-pptx>=0.6.23`); added `docs` to `[all]`
