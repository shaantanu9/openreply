# Paper full-text PDF fetch + cache (replaces abstract-only LLM input)

**Date:** 2026-04-26
**Type:** Feature

## Summary

The paper sources (arXiv, OpenAlex, Semantic Scholar, Google Scholar, PubMed) only persisted titles + abstracts in `posts.selftext` — capped at 2000 chars. Every downstream consumer (paper_analyze LLM, chat context, insights synthesis) was effectively reasoning about the title + abstract, never the actual paper. The methodology, dataset numbers, results, and limitations — exactly the parts that make a paper useful as evidence — were lost.

This ships an on-demand PDF download + text-extraction pipeline with disk cache. The infrastructure was already partially there (`pypdf` is a project dependency, `local_file._parse_pdf_pypdf` works for ingest); the missing piece was a source-aware resolver that maps a paper post to a downloadable PDF URL, downloads it with size + content-type guards, runs the existing extractor, and caches the text under `<data_dir>/paper_cache/<source>/<post_id>.txt`. Cache hits return in ~5ms; first downloads are 2-8s depending on PDF size.

End-to-end verified on "Attention Is All You Need" (`arxiv_1706.03762`): downloaded → parsed → cached **39,643 chars** of real paper text vs the 2000-char abstract. Second call hits the cache (`cached=True`).

## Changes

- **`src/reddit_research/research/paper_fulltext.py`** (NEW) — full-text fetcher module with:
  - `get_full_text(post_id, force=False)` — single entry point. Returns `{ok, status, text, char_count, source, pdf_url, cached}`. Status values: `ok / empty / not_oa / download_failed / parse_failed / unsupported / not_found`. Never raises.
  - `get_full_text_or_abstract(post_id, max_chars)` — convenience wrapper that prefers full text when available and falls back to the abstract when the PDF isn't reachable. Returns a `tier` flag (`full_text / abstract / title_only`) so callers know what they got.
  - `fetch_bulk(topic, sources, limit, skip_failed)` — bulk-fetch every paper post for a topic, with politeness sleeps and a permanent-failure skip list so we don't re-hammer paywalled DOIs.
  - `get_status_summary(topic)` — aggregate row counts by status.
  - `_resolve_pdf_url(source, url, post_id, metadata)` — source-specific URL resolver:
    - **arxiv**: derives `/pdf/<id>.pdf` from URL or post_id.
    - **openalex / semantic_scholar / scholar**: prefers `metadata.oa_url` / `openAccessPdf`, falls back to a PDF-looking post URL.
    - **pubmed**: returns None today (PMC OA roundtrip is a v2 follow-up).
  - `_download_pdf(url, dest)` — streams with httpx, hard cap at 15 MB, rejects HTML content-type, rejects payloads <1 KB.
  - `_extract_text(pdf_path)` — wraps `local_file._parse_pdf_pypdf` (the same extractor the ingest folder pipeline uses).
  - On-disk cache at `<data_dir>/paper_cache/<source>/<post_id>.txt`, hard cap 200k chars per paper.
  - SQLite metadata table `paper_full_texts(post_id, source, pdf_url, char_count, status, error, cache_path, fetched_at)` with indexes on `status` and `source` so the desktop app can show "12 papers full-text-fetched, 4 not_oa, 1 download_failed" without scanning the cache directory.

- **`src/reddit_research/research/paper_analyze.py`** — `analyze_paper` now calls `get_full_text_or_abstract` instead of using the bare `posts.selftext`. The LLM gets the full PDF text (truncated to 30k chars) when an OA copy is reachable; falls back to the abstract otherwise. Result includes `content_tier` so the desktop app can show "analysis based on full PDF" vs "abstract only".

- **`src/reddit_research/research/chat.py`** — `_topic_context` now splices a 3.5k-char excerpt (first 2.5k + last 1k = intro/abstract + conclusions/limitations) of cached full text into the Evidence section for any paper post we've already fetched. Read-only — chat does NOT trigger downloads inline (would block the response 5-15s per paper); user runs `paper-fulltext` ahead of time or relies on lazy population by `analyze-paper`.

- **`src/reddit_research/cli/main.py`** — new command `research paper-fulltext`:
  ```
  reddit-cli research paper-fulltext --post-id arxiv_2403.12345 --show
  reddit-cli research paper-fulltext --topic "AI coding assistants"
  reddit-cli research paper-fulltext --status --topic "AI coding assistants"
  ```
  Single-post mode prints status + cache path; `--show` dumps the first 8k chars. Bulk mode walks every paper for a topic and reports `total / fetched / skipped / failed`.

- **`src/reddit_research/mcp/server.py`** — two new MCP tools:
  - `openreply_paper_fulltext(post_id, force, max_chars)` — same shape as `get_full_text`, with `max_chars` truncation so a 200k-char paper doesn't blow MCP message limits on small clients.
  - `openreply_paper_fulltext_status(topic)` — aggregate counts.
  Both tools auto-register the per-call logging events introduced in `2026-04-26_01` (you'll see them in `mcp logs --tool openreply_paper_fulltext`).

## Files Created

- `src/reddit_research/research/paper_fulltext.py`
- `changelogs/2026-04-26_02_paper-fulltext-pdf-fetch-and-cache.md`

## Files Modified

- `src/reddit_research/research/paper_analyze.py` — use full text when available
- `src/reddit_research/research/chat.py` — splice paper excerpts into chat context
- `src/reddit_research/cli/main.py` — `paper-fulltext` Typer command
- `src/reddit_research/mcp/server.py` — `openreply_paper_fulltext` + `_status` tools

## Verification

```
=== paper-fulltext --post-id arxiv_1706.03762 (real arxiv paper) ===
ok · source=arxiv · chars=39643 · cached=False
   cache=/tmp/.../paper_cache/arxiv/arxiv_1706.03762.txt

=== second call (cache hit) ===
ok · source=arxiv · chars=39643 · cached=True

=== unsupported source returns clean error (no crash) ===
✅ unsupported: source 'reddit' has no full-text resolver
✅ not_oa: no PDF URL available for this source/post
```

- `paper_full_texts` SQLite table created idempotently on first write.
- `paper_fulltext` module imports clean. `chat`, `paper_analyze` imports clean.
- Both MCP tools (`openreply_paper_fulltext`, `openreply_paper_fulltext_status`) appear in `_list_tools()`.

## Out of scope (follow-ups)

- **PubMed PMC roundtrip** — needs an Entrez query for PMID → PMC ID → `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC<id>/pdf/`. Today PubMed papers return `not_oa`.
- **Section-aware extraction** — currently the cache is flat text. A v2 could parse `Abstract / Introduction / Methods / Results / Discussion / Conclusion` headers and store per-section so `analyze_paper` can ship just the Results to the LLM when the user asks "what did they find?".
- **OpenAlex `oa_url` persistence** — the OpenAlex fetcher doesn't yet stash `metadata.oa_url` so the resolver only catches papers where the post URL itself is the PDF. A follow-up will store the OA URL in `metadata_json` at fetch time.
- **Background pre-fetch** — auto-trigger `fetch_bulk` after a `research collect` lands paper rows, so the cache warms up while the user is doing other things. Trade-off: bandwidth + disk usage.
- **Image-only PDFs (scans)** — pypdf returns <200 chars and we mark `status=empty`. A v2 could OCR with Tesseract for that case, but ROI is low (~5% of arxiv).
