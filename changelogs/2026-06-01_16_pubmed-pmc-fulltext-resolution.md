# PubMed → PMC Open Access full-text resolution

**Date:** 2026-06-01
**Type:** Feature

## Summary

PubMed papers were abstract-only everywhere (analyze LLM, chat, insights)
because the per-source full-text resolver in `paper_fulltext.py` returned
`None` for `source == "pubmed"` with a `TODO(v2)`. This wires up real
PMID → PMCID → PMC open-access full-text resolution via NCBI E-utilities,
so open-access PubMed papers now contribute their full body (methodology,
results, limitations) instead of just the abstract.

The PMC OA service in practice only ever returns a `tgz` package (never a
standalone `format="pdf"` link), so the shared PDF-download + pypdf flow
can't serve PubMed for the common case. The reliable route is the JATS XML
body via `efetch`, parsed with a dependency-free tolerant regex pass. Closed
/ non-PMC papers fail soft to `status='not_oa'` and stay abstract-only — no
regression for paywalled PubMed content.

## Changes

- Added NCBI helpers in `paper_fulltext.py`:
  - `_ncbi_params()` — merges optional `NCBI_API_KEY` (S2-style env opt-in).
  - `_pmid_from_post()` — derives the bare PMID from `pubmed_<PMID>` id / URL.
  - `_pmid_to_pmcid()` — PMID → PMCID via the NCBI idconv service (JSON).
  - `_pmcid_oa_pdf_url()` — asks the PMC OA service for a real PDF link
    (rare; normalises `ftp://` → `https://`), used only when a paper
    genuinely exposes a direct OA PDF.
  - `_strip_jats()` — extracts readable body text from PMC JATS XML
    (drops tables/figures/formulae, block tags → newlines, unescapes).
  - `_fetch_pmc_jats_text()` — efetch `db=pmc&rettype=xml` → body text.
  - `_resolve_pmc_fulltext(pmid, doi=None)` — module-level helper as
    requested; PMID→PMCID→OA-PDF (the rare direct-PDF case).
  - `_pubmed_full_text()` — the PubMed branch: PMID→PMCID→JATS body, feeds
    the shared cache/return contract; soft-fails to `not_oa`.
  - `_finalize_text()` — factored the shared tail (truncate, surrogate
    scrub, disk cache, `status='ok'`, auto-index, return) so the PDF and
    JATS paths are byte-identical in their caching + return shape.
- Wired the PubMed branch into `get_full_text()` (routes `source=="pubmed"`
  to `_pubmed_full_text` before the generic PDF resolver).
- Replaced the `pubmed` `TODO(v2)` in `_resolve_pdf_url()` with a real
  `_resolve_pmc_fulltext()` call (covers the rare direct-OA-PDF case).
- Added `"pubmed"` to the default `fetch_bulk` source list so bulk fetch
  now includes PubMed.
- NCBI etiquette respected throughout: reuses `sources/_http.DEFAULT_HEADERS`
  (polite UA), `_NCBI_TIMEOUT = 20s`, ≥0.34s spacing between the two NCBI
  hops, optional `NCBI_API_KEY`. No new dependencies (httpx + stdlib only).

## Verification

- `ast.parse` + `py_compile`: OK.
- Imports OK: `get_full_text`, `get_full_text_or_abstract`, plus new helpers.
- Live: PMID 32015508 → PMC7094943 → 21,254 chars of real JATS body text.
- Soft-fail confirmed: non-PMC PMID and `None` pmid both return `None`
  without raising; closed papers map to `status='not_oa'`.

## Files Modified

- `src/gapmap/research/paper_fulltext.py` — PubMed→PMC full-text resolution
  (helpers + `get_full_text` branch + `_resolve_pdf_url` + `fetch_bulk`
  default sources).
