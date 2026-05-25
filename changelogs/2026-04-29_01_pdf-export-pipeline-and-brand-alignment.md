# PDF Export Pipeline + DOCX/PPTX Brand Alignment

**Date:** 2026-04-29
**Type:** Feature + UI Enhancement

## Summary

Studied the existing markdown→PDF pipeline at `docs/demo_pdf/pdf_build/`
(the build that produced the lending-marketplace deep-dive PDF) and:

1. Bundled its `header.tex` + `widen-quote.lua` inside the package so
   they ship with the wheel.
2. Added a `build_pdf_from_markdown()` function that reproduces the
   pipeline (pandoc → XeLaTeX with the same custom header + Lua filter +
   DejaVu / Poppins fonts + A4 geometry).
3. Aligned the DOCX / PPTX exporters to the **same brand**: accent color
   shifted to `#1F4E79` (the PDF's `accentblue`), Poppins becomes the
   primary sans-serif (matches the PDF's `sansfont`), DejaVu Sans takes
   over body text (matches the PDF's `mainfont`), and grays now use the
   exact PDF tokens (`softgray #595959`, `lightgray #808080`,
   `rulegray #BFBFBF`, `codebg #F6F8FA`).
4. Added a `widen_quote_columns()` Python helper that mirrors the Lua
   filter's table-width logic — when a DOCX table has a `Quote` header
   it gets 50% width, the rest distribute by header weight (Source 1.4,
   ID 1.0, Score 0.7).
5. New `add_page_chrome()` that puts a brand header + footer on every
   docx page, mirroring the PDF's `fancyhdr` layout.

End result: a single visual identity across PDF, DOCX, and PPTX —
no more drift between formats.

## Changes

### New: PDF builder (markdown → polished PDF)

- `src/reddit_research/research/_doc_assets/pdf/header.tex` — bundled
  copy of the demo's LaTeX header. Brand strings (title / subtitle /
  link) are parameterised via `\providecommand` so a single template
  serves any brief.
- `src/reddit_research/research/_doc_assets/pdf/widen-quote.lua` —
  bundled copy of the Lua table-width filter.
- `build_pdf_from_markdown(md_path, out_path, title, subtitle,
  brand_link, brand_link_url, extra_pandoc_args)` — graceful auto-detect
  of XeLaTeX (PATH + standard MacTeX/TeX-Live install dirs); returns a
  structured `{ok: False, install_hint}` if missing instead of crashing.
- New MCP tool: `gapmap_export_pdf_from_markdown`.
- New CLI flag: `research export-deck --format md-to-pdf`.

### Brand alignment (`_doc_design.py`)

- Palette rewritten to match `header.tex`:
    - `ACCENT` `#1F4E79` (was `#2563EB`)
    - `ACCENT_SOFT` `#2E75B6` (new — secondary / link color)
    - `ACCENT_TINT` `#E6EFF7` (new — pale fill)
    - `MUTE` `#595959`, `MUTE_LIGHT` `#808080`, `HAIRLINE` `#BFBFBF`,
      `CARD_FILL` `#F6F8FA` (all matching PDF tokens)
- Type ramp updated:
    - `FONT_SANS` `Poppins` (was `Inter` — Inter kept as fallback)
    - `FONT_BODY` `DejaVu Sans` (new — wide-coverage UTF-8)
    - `FONT_MONO` `DejaVu Sans Mono` (was `JetBrains Mono` — kept as fallback)
- New helpers:
    - `widen_quote_columns(table, quote_width=0.5, weights=...)` — Python
      port of the Lua filter for DOCX tables.
    - `add_page_chrome(doc, header_left, header_right, footer_left,
      footer_link, footer_right, show_page_numbers)` — brand header +
      footer on every page (matches PDF `fancyhdr`).
    - `MUTE_LIGHT`, `ACCENT_TINT`, `FONT_BODY` exposed via `__all__`.

### Packaging

- `pyproject.toml` `[tool.setuptools.package-data]` — registers the
  bundled `_doc_assets/pdf/*.tex` and `*.lua` so they ship in the wheel.

## Verified

- `build_pdf_from_markdown()` returns `{ok: False, install_hint}` cleanly
  on a host with no XeLaTeX installed (this dev box) — confirms the
  graceful-degradation path.
- `build_docx_from_markdown()` still produces a valid 55 KB DOCX after
  the brand-reference doc was deleted from cache and regenerated using
  the new fonts (verified with the same lending-marketplace source).

## Files Created

- `src/reddit_research/research/_doc_assets/pdf/header.tex`
- `src/reddit_research/research/_doc_assets/pdf/widen-quote.lua`
- `docs/research/2026-04-29_lending-deep-dive-rebrand.docx` —
  regenerated DOCX with the new Poppins + `#1F4E79` brand
- `changelogs/2026-04-29_01_pdf-export-pipeline-and-brand-alignment.md` —
  this changelog

## Files Modified

- `src/reddit_research/research/_doc_design.py` — palette + fonts
  rewritten, new `widen_quote_columns` + `add_page_chrome` helpers,
  `__all__` updated.
- `src/reddit_research/research/export_deck.py` — new
  `build_pdf_from_markdown()`, new `_find_xelatex()` discovery helper,
  new `_pdf_assets_dir()` resolver, `__all__` updated.
- `src/reddit_research/mcp/server.py` — new
  `gapmap_export_pdf_from_markdown` MCP tool.
- `src/reddit_research/cli/main.py` — `research export-deck` accepts
  `--format md-to-pdf`.
- `pyproject.toml` — `[tool.setuptools.package-data]` for the bundled
  PDF assets.

## Usage

```bash
# CLI
reddit-cli research export-deck \
  --format md-to-pdf \
  --md-in docs/research/2026-04-28_lending-marketplace-deep-dive.md \
  --out  docs/research/2026-04-28_lending-marketplace-deep-dive.pdf \
  --title "Home-Improvement Lending Marketplace" \
  --subtitle "Deep-Dive Research"

# MCP
gapmap_export_pdf_from_markdown(
  md_path="docs/research/<brief>.md",
  out_path="docs/research/<brief>.pdf",
  title="...", subtitle="...",
)
```

## Install hints

The PDF builder needs a TeX distribution. On macOS:

```bash
brew install --cask basictex
sudo tlmgr update --self
sudo tlmgr install xetex titlesec titling fancyhdr enumitem \
                   microtype fvextra quoting seqsplit framed
```

Then either restart the shell or `eval "$(/usr/libexec/path_helper)"` so
`/Library/TeX/texbin/xelatex` is on PATH.
