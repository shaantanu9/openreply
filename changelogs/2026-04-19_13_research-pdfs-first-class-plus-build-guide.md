# Research papers + PDFs as first-class evidence; Report becomes a build guide

**Date:** 2026-04-19
**Type:** Feature / Fix

## Summary

Before this change, the pipeline fetched from arXiv / OpenAlex / PubMed / Scholar, but the science evidence quietly disappeared before the LLM ever saw it — `corpus_for` filtered `p.score >= 1`, arXiv/PubMed fetchers hardcode `score=0`, and every corpus row was rendered to the prompt as `[id] (r/sub, Nc M↑)` regardless of source. Academic papers became invisible second-class citizens. PDFs weren't ingestable at all.

This change fixes the silent exclusion, makes the LLM source-aware, teaches it to ingest PDFs (with structure-preserving extraction when Java is available), adds a first-class **Research** tab on the topic page, and turns the **Report** tab into a proper build guide that cites papers alongside Reddit threads.

## Changes

### 1. Fix silent exclusion of score=0 papers — `research/collect.py`

`corpus_for()` and `corpus_temporal_split()` used `WHERE p.score >= min_score`, which drops zero-citation arXiv preprints, zero-score PubMed abstracts, and every ingested PDF (they all store score=0). Now:

```sql
WHERE tp.topic = ?
  AND (p.score >= ? OR coalesce(p.source_type,'reddit') != 'reddit')
```

min_score only gates Reddit. Every non-Reddit source (academic + ingest) reaches the LLM regardless of engagement.

### 2. Source-aware corpus formatting — new `research/corpus_format.py`

Added a single `format_corpus()` helper used by every LLM-facing path. Each row is prefixed with its source type so the model knows what it's reading:

- Reddit: `[r_abc] r/rust (12↑ 5c) — Title`
- arXiv: `[arxiv:2401.12345] arXiv — Title`
- PubMed: `[pubmed:12345] PubMed — Title`
- Scholar: `[scholar:hash] Scholar (340 cites) — Title`
- OpenAlex: `[oa:W123] OpenAlex (120 cites) — Title`
- App Store: `[appstore:id] App Store review (4★) — Title`
- Ingested: `[ingest:file.pdf] Local file — Title`
- etc. (HN, GitHub, DevTo, Lemmy, Mastodon, gnews, SO, Wikipedia, Discourse)

Wired into `gaps.py` (replaces the old `_format_corpus` there), `chat.py` (evidence-posts bullet list), and transitively into every extractor prompt.

### 3. `chat.py` evidence sampling now mixes Reddit + academic

Previously ranked evidence posts by `score + num_comments` — drowning out academic sources (score=0). Now `_topic_context` takes half its sample from Reddit (top-engagement) and half from non-Reddit sources. arXiv papers / ingested PDFs always appear in chat context.

### 4. PDF ingest — dual extractor

Extended `sources/local_file.py` with `.pdf` support. Two extractors chained:

- **`opendataloader-pdf`** (preferred) — Java-backed, emits markdown with preserved headings (Abstract / Methods / Results / References), tables, and semantic structure. Massive quality win for scientific papers. Requires Java 11+ on the machine. Added as optional `ingest-rich` extra in `pyproject.toml`.
- **`pypdf`** (fallback) — pure Python, flat text. Always available. Added as core `sources` dep.

Wrapper `_parse_pdf` transparently tries opendataloader first, falls back to pypdf. Both fail → clear error message pointing user at `ocrmypdf` for scanned docs. Tested end-to-end on "Attention Is All You Need" (arxiv 1706.03762) — opendataloader yields 40k chars of markdown with `#` headings preserved; pypdf yields 39k chars of flat text. Both go through `ingest:filename.pdf` as source_type.

CLI help updated: `Formats: .csv .json .txt .vtt .srt .md .pdf`

### 5. Report upgraded to a citation-rich build guide — `research/report_pro.py`

Two additions:

**Science & research evidence section** — between corpus stats and painpoints. Lists every non-Reddit row grouped by source (arXiv → OpenAlex → PubMed → Scholar → Ingested docs). Each entry has:
- Clickable title linking to the paper's URL / DOI / permalink
- Citation count badge (Scholar, OpenAlex)
- Author line when available
- 200-char excerpt (abstract / opening paragraph)

Shown only when the topic has at least one non-Reddit source — silent when you're Reddit-only.

**"How to use this report" footer** — instructs the reader on what each section is for and gives a day-1→day-6 workflow. Turns a passive summary into an actionable build plan. Every product question (market validation / backlog / positioning / roadmap / credibility / user research) is mapped to a specific section of the report.

### 6. Research tab on the topic page — `app-tauri/src/screens/topic.js`

New tab between Sources and Chat, rendered as `<i data-lucide="book-open"></i> Research`. Shows:

- Papers grouped by source (arXiv, OpenAlex, PubMed, Scholar, Ingested docs)
- Per-source badge (color + label)
- Paper card: title, source badge, citation count (where relevant), date, author, abstract excerpt, **Open** button → launches the URL/DOI in the external browser via `api.openUrl`
- "Show N more" pagination per source (10 at a time)
- Empty state with two CTAs: rerun collect (to fetch academic sources) or ingest a PDF

### 7. Docs — `docs/HOW_TO_USE.md`

Step-by-step guide explaining the full flow: configure LLM → collect → ingest PDFs → enrich → read each tab → iterate. Documents the "what to do with the Report" day-by-day workflow, troubleshooting section, and file-system layout. Acts as the product's onboarding doc.

## Files Created

- `src/reddit_research/research/corpus_format.py` — source-aware LLM formatter
- `docs/HOW_TO_USE.md` — end-to-end user guide

## Files Modified

- `src/reddit_research/research/collect.py` — `corpus_for` + `corpus_temporal_split` exempt non-Reddit sources from min_score floor
- `src/reddit_research/research/gaps.py` — switches to shared `format_corpus`
- `src/reddit_research/research/chat.py` — balanced Reddit/academic evidence sampling; source-aware rendering via `_format_row`
- `src/reddit_research/research/report_pro.py` — new Science & research section, "How to use this report" footer
- `src/reddit_research/sources/local_file.py` — `.pdf` support with dual extractor (`opendataloader-pdf` preferred, `pypdf` fallback)
- `src/reddit_research/cli/main.py` — ingest help text now lists `.pdf`
- `pyproject.toml` — `pypdf` added to `[sources]` extra, `opendataloader-pdf` added as `[ingest-rich]` optional extra
- `app-tauri/src/screens/topic.js` — new Research tab + `loadResearch` function

## Verification

- `python -m pytest -x -q` → 29 passed, 1 skipped
- `node --check topic.js` → clean
- `npm run build` → 1730 modules transformed, no errors
- Live PDF extraction test against arxiv 1706.03762 → opendataloader yields markdown with `# arXiv:…` / `###### Attention Is All You Need` / `###### Ashish Vaswani` preserved; pypdf yields flat text; wrapper routes correctly.
