# Paper full-text fetcher: schema fix, size-cap removal, surrogate handling, pre-download notice

**Date:** 2026-04-27
**Type:** Fix (follow-up to 2026-04-26_02)

## Summary

Yesterday's `paper_fulltext` module shipped with three real bugs that surfaced the moment the user ran it against their production DB via MCP:

1. **`OperationalError: no such column: metadata_json`** — the resolver tried to read `posts.metadata_json` but the existing schema has no such column. Calls crashed before the download could even start.
2. **15 MB hard cap rejected legitimate research papers.** `arxiv_2302.07344v1` and `arxiv_2406.08451v2` are both >15 MB and were marked `download_failed`. The user explicitly asked for the guard to come off for research papers (they want the full content regardless of size; the cap was a generic-safety holdover that doesn't fit the research workflow).
3. **`UnicodeEncodeError: 'utf-8' codec can't encode character '\ud835': surrogates not allowed`** — math-heavy papers (`arxiv_2406.08451v2` used `\ud835` math italic codepoints) crashed the cache write. pypdf can extract them but the file system rejects lone surrogates as UTF-8.

Plus one minor data bug surfaced by the cap removal: a previously-failed paper had left a 0-byte cache file behind. The `cache.exists()` short-circuit returned that empty file as a successful hit, reporting `ok` with `char_count=0`. Now treated as a miss.

The user's second clarification was "tell the user before about this" — meaning they want a heads-up of how big a download will be *before* it starts, so a 100 MB pull doesn't happen silently. A HEAD-request size preview is now logged to stderr (and through the MCP tool wrapper into `mcp_events`) before each download.

## Changes

- **`src/reddit_research/research/paper_fulltext.py`**:
  - **Metadata column resilience.** The `metadata_json` lookup now wraps `db.query` in `try/except sqlite3.OperationalError` — when the column is absent (older schema), we silently fall through with `metadata = {}` and rely on `posts.url` as the OA hint. Real DB errors are still recorded as `download_failed` so they're debuggable.
  - **Size cap relaxed.** `MAX_PDF_BYTES` raised from 15 MB to 500 MB (env-tunable via `PAPER_FULLTEXT_MAX_PDF_BYTES`). `MAX_TEXT_CHARS` raised from 200k to 1M (env-tunable via `PAPER_FULLTEXT_MAX_CHARS`). Cap is now purely a runaway-stream guard, not a size policy.
  - **Pre-download size notice.** New `_peek_pdf_size(url)` helper does an HTTP HEAD to learn `Content-Length` before streaming. Result is printed to stderr in the form `[paper-fulltext] downloading 47.3 MB PDF: <url>` and threads through MCP's `tool_call` event payload so clients see it too. Advisory only — never rejects.
  - **Surrogate-safe cache write.** Before `cache.write_text`, the extracted text now passes through `text.encode('utf-8', errors='replace').decode('utf-8', errors='replace')` so lone surrogate codepoints (math glyphs from pypdf) become `U+FFFD` instead of crashing the write. A belt-and-braces fallback strips non-BMP if even the replace path fails. We lose a few math glyphs; we keep 99% of the paper.
  - **Empty cache treated as miss.** The cache short-circuit now requires `len(text) >= MIN_USEFUL_CHARS` (200) before treating an existing file as a hit. A 0-byte cache file from a prior failed run is unlinked and a fresh fetch is attempted instead of returning `ok` with empty text.
  - **Higher download timeout.** `httpx.stream` timeout raised from 30 s to 120 s — research papers on slow networks legitimately take more than 30 s.
  - **Larger chunk size.** Stream chunk raised from 64 KB to 256 KB for less syscall churn on big PDFs.

## Verification

```
=== before fix (production DB) ===
✗ Error calling tool 'openreply_paper_fulltext': no such column: metadata_json

=== after fix, real arxiv posts from the user's DB ===
arxiv_1805.02399v1  → ok · chars=30589
arxiv_2111.01631v2  → ok · chars=40207
arxiv_2409.04167v1  → ok · chars=63594
arxiv_2302.07344v1  → ok · chars=86127   (was: download_failed, oversized)
arxiv_2406.08451v2  → ok · chars=83974   (was: UnicodeEncodeError + oversized)

=== status summary ===
{ "by_status": { "ok": 5 } }

=== pre-download notice ===
[paper-fulltext] downloading 15.2 MB PDF: https://arxiv.org/pdf/2406.08451v2.pdf
```

5/5 papers now extract cleanly, including the two that crashed yesterday.

## Files Modified

- `src/reddit_research/research/paper_fulltext.py` — five fixes above; `import sys` added for the stderr notice; `_peek_pdf_size` helper added.
- `changelogs/2026-04-27_01_paper-fulltext-fixes-size-cap-encoding-schema.md` (this entry).

## Scope of cap removal — research papers ONLY

The 500 MB ceiling lives only in `paper_fulltext.py`, which by design only resolves `arxiv / openalex / semantic_scholar / scholar / pubmed`. The local-file ingest path (`local_file.py`, used for the user's own `.md` / `.pdf` / `.txt` uploads) has its own conservative size policy and is unchanged — different code path, different threat model. So the relaxed cap is correctly scoped to academic paper downloads.

## Out of scope (still pending from 2026-04-26_02)

- **PubMed PMC roundtrip** — still returns `not_oa`. PMID → PMC ID → `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC<id>/pdf/` Entrez fetch is the v2 path.
- **Section-aware extraction** — flat text only today; per-section parsing (Abstract / Methods / Results / Discussion) would let `analyze_paper` ship just the relevant section to the LLM.
- **OpenAlex `oa_url` persistence** — the OpenAlex fetcher still doesn't stash `metadata.oa_url`, so OpenAlex resolution falls back to whatever's in `posts.url`. Adding the column + writing it at fetch time is a small follow-up.
- **Background pre-fetch** — auto-trigger `fetch_bulk` after `research collect` so the cache warms while the user does other things.
- **OCR for scan-only PDFs** — `status=empty` papers (image-only) could be OCR'd with Tesseract; ROI low (~5% of arxiv).
