# Brand Design System for DOCX Exports

**Date:** 2026-04-28
**Type:** UI Enhancement

## Summary

Replaced the default-Word-styles output of `build_docx` and `build_docx_from_markdown` with a single canonical brand design system used by both renderers. New module `_doc_design.py` owns the palette, typography ramp, table style, cover-page builder, KPI strip, painpoint cards, severity chips, and quote blocks. The data-driven path now follows a `gather → plan → render` pipeline so an LLM (or human) can inspect / hand-edit the layout plan before committing to bytes.

The pandoc path automatically generates and applies a brand reference docx — markdown→docx output now inherits the same fonts, colors, headings, and quote style as the data-driven output. No more visual drift between the two formats.

A strict design-system prompt is exposed via the `gapmap_doc_design_prompt` MCP tool so any LLM that designs a layout plan respects the same invariants the renderer enforces.

## Changes

### New design system (`_doc_design.py`)

- **Palette**: one accent (`#2563EB`), Ink/Body/Mute neutrals, severity colors (HIGH `#DC2626`, MED `#D97706`, LOW neutral, WIN `#059669`), hairline `#E2E8F0`, card fill `#F8FAFC`
- **Type ramp**: Inter (with Helvetica Neue / Calibri fallbacks) — Title 32pt · Subtitle 14pt italic · H1 20pt · H2 15pt · H3 12pt · Body 10.5pt @ 1.4 line-spacing · Quote 11pt italic with left accent bar
- **Helpers**: `style_table`, `add_cover_page`, `add_kpi_strip`, `add_section_header` (eyebrow + numbered + hairline rule), `add_callout` (info/warn/win), `add_quote_block` (accent left-bar), `add_severity_chip_run` (inline pill), `add_painpoint_card`, `add_divider`, `make_brand_reference_docx`
- **Low-level OOXML helpers** for cell shading, borders, margins, and paragraph borders that python-docx does not expose
- **`DESIGN_SYSTEM_PROMPT`** — strict design rules an LLM must follow when planning a layout

### Refactored data-driven exporter (`build_docx`)

- New `plan_layout()` returns a JSON layout plan with cover + sections (`executive_summary`, `corpus_table`, `painpoint_cards`, `competitor_matrix`, `quote_wall`, `feature_roadmap`, `citation_index`)
- New `render_planned_docx()` consumes the plan and renders via the design system
- `build_docx()` is now `plan_layout` + `render_planned_docx` glued together
- Painpoints render as cards with severity chips colored by opportunity score; competitor matrix sorted by 1★ rate descending with color-coded hostility column (≥30% red, 15–30% amber, <15% green); cover ships a 4-column KPI strip

### Brand reference doc auto-applied to pandoc path

- `_ensure_brand_reference_docx()` generates the reference doc on first call, caches it in `~/.gapmap/brand-reference.docx`
- `build_docx_from_markdown()` now passes that reference doc to pandoc automatically (callers can still override with `reference_docx`)
- Markdown→docx output grew from 43 KB → 55 KB because the brand styles now ship with it

### New MCP tools

- `gapmap_doc_design_prompt()` → returns the strict design-system prompt + section-kind enum
- `gapmap_plan_doc_layout()` → returns the JSON plan without rendering
- `gapmap_render_planned_docx(plan, out_path)` → renders an LLM-edited plan

## Files Created

- `src/reddit_research/research/_doc_design.py` — design system module (~470 LOC)
- `changelogs/2026-04-28_06_export-deck-brand-design-system.md` — this changelog

## Files Modified

- `src/reddit_research/research/export_deck.py` — `build_docx` refactored to `plan_layout` + `render_planned_docx`; `build_docx_from_markdown` auto-applies brand reference doc; new `get_design_system_prompt` accessor
- `src/reddit_research/mcp/server.py` — added `gapmap_doc_design_prompt`, `gapmap_plan_doc_layout`, `gapmap_render_planned_docx` MCP tools

## Smoke test (verified)

`docs/research/2026-04-28_lending-marketplace-deck.docx` (data-driven, 43.7 KB):
- Cover: `RESEARCH BRIEF · APR 2026` (accent eyebrow) → `Home-Improvement Lending Marketplace` 32pt → italic mute subtitle
- KPI strip: `2,030 / 13 / 12 / 10` (corpus posts / sources / painpoints / competitors)
- Section headers carry eyebrow + accent number + hairline rule
- Painpoint cards render with `HIGH` severity chip, freq/opp captions, evidence quote with accent-bar
- Competitor matrix lists `Hearth for Contractors · App Store` first (54.5% 1★ rate) — sorted by hostility

`docs/research/2026-04-28_lending-marketplace-deep-dive.docx` (md-driven, 55.6 KB) regenerated via pandoc with the auto brand reference docx.
