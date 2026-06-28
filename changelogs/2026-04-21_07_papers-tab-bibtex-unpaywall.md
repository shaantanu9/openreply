# Papers tab + BibTeX/RIS/APA/MD export + Unpaywall OA lookup

**Date:** 2026-04-21
**Type:** Feature

## Summary

Closes the "college student opens the app and gets real value" gap without changing the core OpenReply vision (user pain + science → product decisions). All additive — Solutions / Concepts / Product Mode / Collect / Graph untouched. The Papers tab surfaces data that was already in `posts` (from arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, Scholar via the Solutions pipeline + MCP fetchers); one-click bibliography export makes OpenReply useful as a research tool for students, UX researchers, and solopreneurs citing evidence in landing pages — same feature, different audiences.

## Changes

### New Python modules
- `sources/unpaywall.py` — free OA PDF finder for any DOI (`lookup_doi`, `enrich_post_row`). Free, no key; optional `UNPAYWALL_EMAIL` env puts us in the polite pool. Verified live: `10.1038/nature12373` → `nature.com/articles/nature12373.pdf`.
- `research/paper_export.py` — BibTeX / RIS / APA / Markdown formatters. Entry-type inference, DOI extraction, author-name normalisation, citation-count ranking. Reads from `posts WHERE source_type IN (arxiv, pubmed, openalex, scholar, semantic_scholar, crossref)` joined with `topic_posts`.

### New CLI subcommands
- `research papers-list --topic X [--limit] [--json]`
- `research papers-export --topic X --fmt bibtex|ris|apa|md [--out PATH] [--limit] [--json]`
- `research oa-lookup --doi X [--json]`

### New Tauri commands
- `papers_list(topic, limit)`
- `papers_export(topic, fmt, limit)`
- `oa_lookup(doi)`

### New MCP tools
- `openreply_papers_export(topic, fmt, limit)` — Claude can dump a bibliography in 4 formats
- `openreply_oa_lookup(doi)` — Claude can fetch legal free PDF URLs mid-conversation

### New UI
- `screens/papers.js` — Papers tab: sortable table (src · title · year · cites · OA), 4 export buttons, Unpaywall OA button per row that opens the free PDF in a new window
- Export modal with copy-to-clipboard + preview textarea
- CSS: `.papers-table`, `.src-badge` (colour per source), `.papers-modal*`

### Wiring
- `topic.js` — imports `loadPapers`, new `<button data-tab="papers">` in the More dropdown (book-marked icon), loader entry
- `main.rs` — 3 new commands registered in `generate_handler!`
- `api.js` — `api.papersList / papersExport / oaLookup`

## Verified

- Python imports: `paper_export`, `unpaywall` ✓
- Unpaywall live: `10.1038/nature12373` → `is_oa=True`, PDF URL returned ✓
- CLI `reddit-cli research papers-export --help` ✓
- `cargo check` ✓
- JS `node --check` on papers.js, topic.js, api.js ✓

## Vision check

This **extends** OpenReply's vision without diluting it:

| Vision pillar | Unchanged? | Note |
|---|---|---|
| Problem → Why → Science → Solution pipeline | ✓ | Papers already flow through this; Papers tab just surfaces them |
| Concept Agent (product ideas from painpoints) | ✓ | Untouched |
| Product Mode (signal-sweep for existing products) | ✓ | Untouched |
| Solopreneur-first monetisation slice | ✓ | BibTeX/APA also useful for solopreneur citing evidence in landing pages |
| Evidence-backed pitch | ✓ | Export makes the evidence *usable* — strengthens the pitch |
| Palace + graph + chat | ✓ | Untouched |
| Database schema | ✓ | No new tables; uses existing `posts` + `topic_posts` |

**Accidentally-discovered 4th audience**: college students. Zero repositioning cost — same feature set, different framing. Not a pivot.

## Files Created

- `src/reddit_research/sources/unpaywall.py`
- `src/reddit_research/research/paper_export.py`
- `app-tauri/src/screens/papers.js`
- `changelogs/2026-04-21_07_papers-tab-bibtex-unpaywall.md` — this entry

## Files Modified

- `src/reddit_research/cli/main.py` — 3 new subcommands (papers-list, papers-export, oa-lookup)
- `src/reddit_research/mcp/server.py` — 2 new MCP tools (papers_export, oa_lookup)
- `app-tauri/src-tauri/src/commands.rs` — 3 new Tauri commands
- `app-tauri/src-tauri/src/main.rs` — register the 3 commands
- `app-tauri/src/api.js` — 3 JS bridges
- `app-tauri/src/screens/topic.js` — Papers tab + loader entry
- `app-tauri/src/style.css` — `.papers-table` + `.papers-modal*` styling

## How students use this

1. Claude (MCP) or Solutions Agent (app): populate papers for a topic
2. Open the topic page in OpenReply → More → **Papers**
3. See every academic source paper with citation count, open the ones they want to cite
4. For paywalled ones, click **OA** → Unpaywall finds the free PDF
5. Click **BibTeX** / **RIS** / **APA** / **Markdown** → paste directly into LaTeX, Zotero, a blog post, or a comparison table

Same flow for UX researchers building a research doc, same flow for a solopreneur adding citations to a landing page. Zero student-specific UI — which is by design: the audience generalises.

## Restart note

Requires `tauri dev` restart because Rust commands were added. After restart: topics with papers (run Solutions pipeline first, or use MCP `openreply_research_papers`) show the new Papers tab in the More dropdown.
