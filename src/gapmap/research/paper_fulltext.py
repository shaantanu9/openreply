"""Fetch + cache full text for academic papers.

Until now the paper sources (arXiv, OpenAlex, Semantic Scholar, PubMed, Google
Scholar) only persisted the abstract in ``posts.selftext`` — at most 2000
characters. Every downstream consumer (paper_analyze LLM, chat context,
insights) was effectively reasoning about the title + abstract, never the
actual paper. That misses the methodology, results numbers, dataset details,
limitations — exactly the parts that make a paper useful as evidence.

This module fixes that with on-demand PDF download + text extraction,
cached on disk so repeat reads are free.

Pipeline:
  1. Look up `<data_dir>/paper_cache/<source>/<post_id>.txt` — cache hit
     means we already extracted, return immediately.
  2. Else resolve the PDF URL (source-specific: arXiv URL is direct;
     OpenAlex/SemanticScholar carry an `openAccessPdf.url` we may have
     stashed in metadata; PubMed needs a PMC OA roundtrip).
  3. Download with httpx (streaming, capped at 15 MB), write to a temp
     `.pdf`, run the existing ``local_file._parse_pdf_pypdf`` extractor
     (already a project dependency — same parser used for ingest folder).
  4. Truncate to MAX_CHARS, write to cache, record an entry in
     `paper_full_texts` SQLite table (post_id, char_count, status,
     fetched_at) so future calls don't waste time on papers that are
     paywalled or yielded zero text.

Status codes in the table:
  ``ok``         – text extracted successfully (char_count > 200)
  ``empty``      – PDF downloaded but pypdf returned <200 chars (image-only
                   scans, encrypted PDFs we can't decrypt)
  ``not_oa``     – source said this paper has no open-access PDF
  ``download_failed`` – HTTP error / non-PDF content / oversized
  ``parse_failed``    – pypdf raised
  ``unsupported``     – source has no resolver wired up yet

Failure mode: every public function returns ``{ok: bool, status, ...}`` and
NEVER raises. A hung paper download must not break the analyze-papers-bulk
batch; it just gets a row with status='download_failed' and the next paper
moves on.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from ..core.db import get_db
from ..core.config import _resolve_data_dir

# Caps for research-paper full text. The earlier 15 MB ceiling rejected
# legitimate long papers (surveys, theses, multi-author proceedings) and
# the user explicitly wants the full content regardless of size — so the
# byte cap is now intentionally generous (500 MB, basically unbounded for
# real arXiv/OpenAlex content). The extracted-text cap also rises to 1 MB
# so a 100-page survey isn't sliced. Override per-call via env vars when
# memory or disk constraints actually bite.
#
# Why we still keep ANY ceiling: a malicious / misconfigured server
# returning an infinite stream would otherwise fill the disk. 500 MB is
# beyond every paper we've seen in the wild but bounded enough to recover
# from.
import os as _os
MAX_PDF_BYTES = int(_os.getenv("PAPER_FULLTEXT_MAX_PDF_BYTES") or (500 * 1024 * 1024))
MAX_TEXT_CHARS = int(_os.getenv("PAPER_FULLTEXT_MAX_CHARS") or 1_000_000)
MIN_USEFUL_CHARS = 200  # below this we treat extraction as failed

CACHE_DIR_NAME = "paper_cache"


def _data_root() -> Path:
    try:
        return _resolve_data_dir()
    except Exception:
        d = Path.home() / ".gapmap"
        d.mkdir(parents=True, exist_ok=True)
        return d


def _cache_path(source: str, post_id: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", post_id)[:160]
    p = _data_root() / CACHE_DIR_NAME / (source or "unknown")
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{safe_id}.txt"


def _ensure_table() -> None:
    """Create paper_full_texts in the same DB the rest of the app uses.
    Idempotent. Indexes on post_id (PK) + status for the common
    "show me everything still missing full text" query."""
    db = get_db()
    if "paper_full_texts" not in db.table_names():
        db["paper_full_texts"].create(
            {
                "post_id": str,
                "source": str,
                "pdf_url": str,
                "char_count": int,
                "status": str,
                "error": str,
                "cache_path": str,
                "fetched_at": str,
            },
            pk="post_id",
        )
        db["paper_full_texts"].create_index(["status"])
        db["paper_full_texts"].create_index(["source"])


def _record_status(
    post_id: str, source: str, status: str,
    *, pdf_url: str = "", char_count: int = 0,
    error: str = "", cache_path: str = "",
) -> None:
    """Upsert a row into paper_full_texts. Keep this short — the row is
    metadata, the actual text lives on disk under `cache_path`."""
    try:
        _ensure_table()
        db = get_db()
        db["paper_full_texts"].upsert(
            {
                "post_id": post_id,
                "source": source,
                "pdf_url": pdf_url[:1000],
                "char_count": int(char_count),
                "status": status,
                "error": (error or "")[:500],
                "cache_path": cache_path,
                "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            pk="post_id",
        )
    except Exception:
        # Logging persistence failures shouldn't break the caller.
        pass


# ── PDF URL resolvers (source-specific) ──────────────────────────────────

_ARXIV_PDF_RE = re.compile(r"https?://arxiv\.org/(?:pdf|abs)/([^/?\s]+)")

# NCBI E-utilities + PMC OA service. We map PMID→PMCID (idconv) and then ask
# the PMC OA service for a downloadable artifact. NCBI politeness: ≤3 req/sec
# without a key, set a polite UA (reuse the project's DEFAULT_HEADERS), short
# timeouts, and send NCBI_API_KEY when present for higher quota. The whole
# helper fails SOFT — any network/parse error or a closed (non-OA) paper
# returns None so the paper stays abstract-only with zero regression.
_NCBI_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
_NCBI_IDCONV = "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/"
_NCBI_OA = "https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi"
# NCBI asks for <3 req/sec without a key; 0.34s spacing keeps us under that.
_NCBI_REQ_SPACING = 0.34
# Short timeout for the metadata lookups (idconv / oa.fcgi). Matches the
# 20s science-API convention in sources/_http.py — these are tiny JSON/XML
# responses, so a hung NCBI server surfaces quickly instead of blocking.
_NCBI_TIMEOUT = 20.0
# OA service returns <link format="pdf" href="..."> and/or format="tgz".
_OA_PDF_LINK_RE = re.compile(
    r'<link\b[^>]*\bformat="pdf"[^>]*\bhref="([^"]+)"', re.IGNORECASE
)


def _ncbi_params(extra: dict | None = None) -> dict:
    """Merge an optional NCBI_API_KEY into request params (S2_API_KEY-style
    env opt-in for higher quota). Mirrors sources/pubmed.py::_get."""
    params = dict(extra or {})
    key = os.getenv("NCBI_API_KEY")
    if key:
        params["api_key"] = key
    return params


def _pmid_from_post(post_id: str, url: str) -> str | None:
    """Recover the bare PMID from a pubmed post row.

    Pubmed rows are saved with id ``pubmed_<PMID>`` and a
    ``https://pubmed.ncbi.nlm.nih.gov/<PMID>/`` URL (see sources/pubmed.py),
    so we can derive the PMID without any extra column."""
    if post_id and post_id.startswith("pubmed_"):
        cand = post_id[len("pubmed_"):]
        if cand.isdigit():
            return cand
    m = re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", url or "")
    if m:
        return m.group(1)
    return None


def _pmid_to_pmcid(pmid: str) -> str | None:
    """Map a PMID to its PMCID via the NCBI idconv service. Returns the
    ``PMC<digits>`` string or None when the article has no PMC record
    (i.e. not in PubMed Central at all). Fails soft on any error."""
    try:
        from ..sources._http import DEFAULT_HEADERS
    except Exception:
        DEFAULT_HEADERS = {"User-Agent": "gapmap/1.0 (paper-fulltext)"}
    try:
        params = _ncbi_params({"ids": pmid, "format": "json"})
        r = httpx.get(
            _NCBI_IDCONV, params=params, headers=DEFAULT_HEADERS,
            timeout=_NCBI_TIMEOUT, follow_redirects=True,
        )
        if r.status_code != 200:
            return None
        records = (r.json() or {}).get("records") or []
        for rec in records:
            pmcid = rec.get("pmcid")
            if isinstance(pmcid, str) and pmcid.upper().startswith("PMC"):
                return pmcid.upper()
        return None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None


def _pmcid_oa_pdf_url(pmcid: str) -> str | None:
    """Ask the PMC OA service for a downloadable artifact for this PMCID.

    Only papers in the PMC Open Access subset get a response with a
    ``<link>``. A closed paper returns an ``<error>`` element (or no link),
    in which case we return None and the caller treats it as not_oa.

    We prefer a ``format="pdf"`` link because the downstream flow downloads a
    PDF and runs pypdf over it — exactly what arXiv/OpenAlex already do. We
    intentionally do NOT fall back to the ``tgz`` archive: it's a tarball,
    not something ``_download_pdf`` / ``_extract_text`` can consume, so a
    PDF-less OA paper stays abstract-only rather than yielding a broken
    download. NB the OA link is usually an ftp:// URL which httpx won't
    fetch, so we normalise it to https:// (NCBI serves the same path over
    https)."""
    try:
        from ..sources._http import DEFAULT_HEADERS
    except Exception:
        DEFAULT_HEADERS = {"User-Agent": "gapmap/1.0 (paper-fulltext)"}
    try:
        params = _ncbi_params({"id": pmcid})
        r = httpx.get(
            _NCBI_OA, params=params, headers=DEFAULT_HEADERS,
            timeout=_NCBI_TIMEOUT, follow_redirects=True,
        )
        if r.status_code != 200:
            return None
        m = _OA_PDF_LINK_RE.search(r.text or "")
        if not m:
            return None
        href = (m.group(1) or "").strip()
        if not href:
            return None
        # OA service hands back ftp:// links; httpx only speaks http(s).
        if href.startswith("ftp://"):
            href = "https://" + href[len("ftp://"):]
        return href or None
    except (httpx.HTTPError, ValueError):
        return None


def _strip_jats(xml: str) -> str:
    """Extract readable body text from a PMC JATS XML document.

    JATS marks the article body with <body>…</body>; inside it, paragraphs,
    titles, and section headings carry the prose. We pull the <body>, drop
    elements that aren't running text (tables/figures/formulae/xrefs), turn
    block-level tags into newlines, strip the remaining tags, and unescape
    entities. This is deliberately dependency-free (no lxml) — a tolerant
    regex pass is enough to recover the methodology/results prose, which is
    the whole point of going past the abstract. Returns "" if no body."""
    import html as _html

    body = re.search(r"<body\b[^>]*>(.*?)</body>", xml, re.DOTALL | re.IGNORECASE)
    if not body:
        return ""
    txt = body.group(1)
    # Drop non-prose subtrees that would otherwise dump markup/garbage.
    for tag in ("table-wrap", "table", "fig", "disp-formula", "inline-formula",
                "tex-math", "mml:math", "graphic", "media", "ext-link"):
        txt = re.sub(rf"<{tag}\b.*?</{tag}>", " ", txt, flags=re.DOTALL | re.IGNORECASE)
    # Block-level tags → paragraph breaks so the text stays readable.
    txt = re.sub(r"</(p|title|sec|caption|list-item|td|tr|abstract)>",
                 "\n", txt, flags=re.IGNORECASE)
    # Strip every remaining tag, unescape entities, collapse blank runs.
    txt = re.sub(r"<[^>]+>", "", txt)
    txt = _html.unescape(txt)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return txt.strip()


def _fetch_pmc_jats_text(pmcid: str) -> tuple[str, str]:
    """Fetch the JATS XML for a PMCID via efetch and extract body text.

    Returns (text, error). Only OA-subset / author-manuscript articles
    return a usable <body>; everything else yields "" (caller maps that to
    not_oa/empty). Fails soft — never raises."""
    try:
        from ..sources._http import DEFAULT_HEADERS
    except Exception:
        DEFAULT_HEADERS = {"User-Agent": "gapmap/1.0 (paper-fulltext)"}
    pmc_num = pmcid[3:] if pmcid.upper().startswith("PMC") else pmcid
    try:
        params = _ncbi_params({"db": "pmc", "id": pmc_num, "rettype": "xml"})
        r = httpx.get(
            f"{_NCBI_EUTILS_BASE}/efetch.fcgi", params=params,
            headers=DEFAULT_HEADERS, timeout=_NCBI_TIMEOUT, follow_redirects=True,
        )
        if r.status_code != 200:
            return "", f"efetch http {r.status_code}"
        return _strip_jats(r.text or ""), ""
    except httpx.HTTPError as e:
        return "", f"httpx: {e}"
    except Exception as e:  # tolerant: regex/decoding edge cases
        return "", f"{type(e).__name__}: {e}"


def _resolve_pmc_fulltext(pmid: str | None, doi: str | None = None) -> str | None:
    """Resolve a PubMed paper to a downloadable PMC Open Access PDF URL, or
    None.

    Steps (each fails soft → None):
      1. PMID → PMCID via NCBI idconv.
      2. PMCID → OA PDF link via the PMC OA service.

    NOTE: the OA service almost always offers only a ``tgz`` package (no
    standalone ``format="pdf"`` link), so this PDF-resolution path returns
    None for most papers — those are handled by the JATS-XML branch in
    ``get_full_text`` instead (``_fetch_pmc_jats_text``), which is the
    reliable route. This function is retained for the rare paper that *does*
    expose a direct OA PDF and so can ride the shared PDF download+pypdf
    flow.

    ``doi`` is accepted for interface symmetry / future fallback (idconv can
    also resolve a DOI) but PubMed rows always carry a PMID, so it's unused
    for now. We space NCBI calls ≥0.34s apart to honour the <3 req/sec
    etiquette."""
    if not pmid:
        return None
    pmcid = _pmid_to_pmcid(pmid)
    if not pmcid:
        return None
    time.sleep(_NCBI_REQ_SPACING)  # be polite between the two NCBI hops
    return _pmcid_oa_pdf_url(pmcid)


def _resolve_pdf_url(source: str, url: str, post_id: str, metadata: dict | None = None) -> str | None:
    """Map a paper row to a downloadable PDF URL when one is available.

    Source-by-source:
      arxiv: ``url`` is already the PDF (set by sources/arxiv.py). If we
             got the abs URL instead, swap to /pdf/.
      openalex / semantic_scholar / scholar: try metadata.oa_url first
             (set when we save the row). Fall back to the post URL if it
             looks PDF-ish.
      pubmed: would need a PMC OA roundtrip; not yet wired (status=
             unsupported until we add it).
    """
    src = (source or "").lower()
    md = metadata or {}

    if src == "arxiv":
        if url.endswith(".pdf"):
            return url
        m = _ARXIV_PDF_RE.match(url or "")
        if m:
            arxiv_id = m.group(1)
            if not arxiv_id.endswith(".pdf"):
                arxiv_id += ".pdf"
            return f"https://arxiv.org/pdf/{arxiv_id}"
        # post_id is `arxiv_<id>` → derive
        if post_id.startswith("arxiv_"):
            return f"https://arxiv.org/pdf/{post_id[len('arxiv_'):]}.pdf"
        return None

    if src in ("openalex", "semantic_scholar", "scholar"):
        oa = md.get("oa_url") or md.get("openAccessPdf")
        if isinstance(oa, dict):
            oa = oa.get("url")
        if isinstance(oa, str) and oa:
            return oa
        # Fall back to the post URL only if it's clearly a PDF.
        if isinstance(url, str) and (url.endswith(".pdf") or "/pdf/" in url):
            return url
        return None

    if src == "pubmed":
        # PMID → PMCID → PMC OA PDF (only papers in the OA subset resolve;
        # closed papers return None and stay abstract-only). PMID comes from
        # the post id (`pubmed_<PMID>`) or the URL; metadata may carry an
        # explicit pmid/doi hint from newer schemas.
        pmid = (
            (str(md.get("pmid")).strip() if md.get("pmid") else None)
            or _pmid_from_post(post_id, url)
        )
        doi = str(md.get("doi")).strip() if md.get("doi") else None
        return _resolve_pmc_fulltext(pmid, doi=doi)

    return None


# ── HTTP fetch + parse ───────────────────────────────────────────────────


def _peek_pdf_size(url: str) -> int | None:
    """Cheap HEAD request to learn the Content-Length before downloading.
    Returns None when the server doesn't expose it (some CDNs strip it on
    HEAD). The caller uses this purely as user-facing context — nothing
    is rejected based on size."""
    try:
        from ..sources._http import DEFAULT_HEADERS
    except Exception:
        DEFAULT_HEADERS = {"User-Agent": "gapmap/1.0 (paper-fulltext)"}
    try:
        r = httpx.head(url, headers=DEFAULT_HEADERS, timeout=10, follow_redirects=True)
        if r.status_code != 200:
            return None
        cl = r.headers.get("content-length")
        return int(cl) if cl and cl.isdigit() else None
    except (httpx.HTTPError, ValueError):
        return None


def _download_pdf(url: str, dest: Path, log_prefix: str = "") -> tuple[bool, str]:
    """Stream a PDF to disk. Returns (ok, error).

    The byte cap is intentionally generous (default 500 MB, tunable via
    PAPER_FULLTEXT_MAX_PDF_BYTES) — research papers can legitimately be
    50-100 MB and the user explicitly opted out of small-file gating.
    Pre-download size from the HEAD request is logged to stderr so the
    user sees "downloading 47 MB" before a long fetch starts; it's
    advisory only, never a rejection.
    """
    try:
        from ..sources._http import DEFAULT_HEADERS
    except Exception:
        DEFAULT_HEADERS = {"User-Agent": "gapmap/1.0 (paper-fulltext)"}

    # Pre-flight: surface size before the download starts. Useful when the
    # caller is interactive — they see "downloading 47 MB pdf…" and can
    # ctrl-C if it's not what they wanted. Also written to mcp_events log
    # via the calling tool's wrapper so MCP clients see it.
    expected_size = _peek_pdf_size(url)
    if expected_size:
        mb = expected_size / (1024 * 1024)
        print(
            f"[paper-fulltext]{log_prefix} downloading {mb:.1f} MB PDF: {url}",
            file=sys.stderr, flush=True,
        )

    try:
        with httpx.stream(
            "GET", url, headers=DEFAULT_HEADERS,
            timeout=120,  # large papers genuinely take time on slow networks
            follow_redirects=True,
        ) as r:
            if r.status_code != 200:
                return False, f"http {r.status_code}"
            ctype = (r.headers.get("content-type") or "").lower()
            if "html" in ctype:
                return False, f"non-pdf content-type: {ctype}"
            written = 0
            with dest.open("wb") as f:
                for chunk in r.iter_bytes(chunk_size=256 * 1024):
                    f.write(chunk)
                    written += len(chunk)
                    if written > MAX_PDF_BYTES:
                        # Only relevant at extreme sizes (default 500 MB);
                        # the cap exists purely as a runaway-stream guard.
                        return False, (
                            f"exceeded MAX_PDF_BYTES ({MAX_PDF_BYTES} bytes) — "
                            f"raise PAPER_FULLTEXT_MAX_PDF_BYTES env if you really need this paper"
                        )
            if written < 1024:
                return False, f"too small ({written} bytes — probably an error page)"
            return True, ""
    except httpx.HTTPError as e:
        return False, f"httpx: {e}"
    except OSError as e:
        return False, f"io: {e}"


def _extract_text(pdf_path: Path) -> tuple[str, str]:
    """Run pypdf over the downloaded PDF. Returns (text, error)."""
    try:
        # Reuse the local_file extractor — same parser already shipped for
        # ingest. Returns (meta_title, body, author).
        from ..sources.local_file import _parse_pdf_pypdf
        _title, body, _author = _parse_pdf_pypdf(pdf_path)
        return body or "", ""
    except Exception as e:
        return "", f"{type(e).__name__}: {e}"


def _finalize_text(
    post_id: str, source: str, text: str, cache: Path, *, pdf_url: str = "",
) -> dict[str, Any]:
    """Shared tail for any successfully-extracted body text (PDF via pypdf
    OR JATS XML via efetch): truncate, scrub bad surrogates, write the disk
    cache, record status='ok', kick the auto-index pipeline, and return the
    standard ok-shape dict. Keeps both extraction paths byte-identical in
    their caching + return contract."""
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS] + "\n\n[... truncated to MAX_TEXT_CHARS ...]"

    # Some PDFs (especially math-heavy ones) yield extracted text with lone
    # Unicode surrogate codepoints (e.g. \ud835 from a math italic char).
    # Python's UTF-8 codec rejects those as "surrogates not allowed", which
    # crashes the write. Round-trip through bytes with errors='replace' to
    # substitute U+FFFD for any unencodable codepoint — we lose a few math
    # glyphs but keep the surrounding 99% of the paper text.
    try:
        text = text.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
    except UnicodeError:
        # Belt-and-braces: if even the replace path fails, strip non-BMP.
        text = "".join(ch for ch in text if 0x20 <= ord(ch) < 0xD800 or ord(ch) > 0xDFFF)

    cache.write_text(text, encoding="utf-8")
    _record_status(post_id, source, "ok",
                   pdf_url=pdf_url, char_count=len(text),
                   cache_path=str(cache))

    # Auto-pipeline: section-parse → chunk → embed → extract refs.
    # Each stage is best-effort and logs to its own table; failures are
    # swallowed so a download that succeeded never appears as "failed"
    # because, e.g., chromadb wasn't installed. Disable per-call by
    # setting PAPER_FULLTEXT_AUTO_INDEX=0 (env) or programmatic callers
    # who own their own pipeline.
    if (os.getenv("PAPER_FULLTEXT_AUTO_INDEX") or "1").strip() not in ("0", "false", "no"):
        _auto_index_after_download(post_id)

    return {
        "ok": True, "status": "ok", "cached": False,
        "post_id": post_id, "source": source,
        "pdf_url": pdf_url, "char_count": len(text),
        "text": text, "cache_path": str(cache),
    }


def _pubmed_full_text(
    post_id: str, source: str, url: str, metadata: dict, cache: Path,
) -> dict[str, Any]:
    """PubMed → PMC full-text branch.

    PubMed papers carry no PDF in ``posts.url`` (it's the pubmed.gov landing
    page). The reliable open-access route is PMC: map PMID→PMCID and pull
    the JATS XML body via efetch. (The PMC OA service only hands back ``tgz``
    packages, not a standalone PDF, so the shared PDF→pypdf flow can't be
    used for the common case — JATS XML is both available and more reliable.)

    Fails SOFT to status='not_oa' for any closed / non-PMC paper or network
    error, so closed PubMed papers stay abstract-only with no regression."""
    pmid = (
        (str(metadata.get("pmid")).strip() if metadata.get("pmid") else None)
        or _pmid_from_post(post_id, url)
    )
    if not pmid:
        _record_status(post_id, source, "not_oa", error="no PMID on row")
        return {"ok": False, "status": "not_oa",
                "error": "no PMID derivable for this pubmed post",
                "post_id": post_id, "source": source}

    pmcid = _pmid_to_pmcid(pmid)
    if not pmcid:
        _record_status(post_id, source, "not_oa",
                       error="PMID has no PMC record (not open access)")
        return {"ok": False, "status": "not_oa",
                "error": "no PMCID — paper is not in PubMed Central",
                "post_id": post_id, "source": source}

    pmc_url = f"https://www.ncbi.nlm.nih.gov/pmc/articles/{pmcid}/"
    time.sleep(_NCBI_REQ_SPACING)  # polite spacing between NCBI hops
    text, ferr = _fetch_pmc_jats_text(pmcid)
    if ferr:
        # Treat fetch/parse failure as download_failed so fetch_bulk won't
        # permanently skip it (a transient NCBI hiccup can be retried).
        _record_status(post_id, source, "download_failed",
                       pdf_url=pmc_url, error=ferr)
        return {"ok": False, "status": "download_failed", "error": ferr,
                "post_id": post_id, "source": source, "pdf_url": pmc_url}

    text = (text or "").strip()
    if len(text) < MIN_USEFUL_CHARS:
        # PMCID exists but no usable <body> — closed full text / abstract-only
        # OA record. Mark not_oa so it stays on the abstract tier.
        _record_status(post_id, source, "not_oa",
                       pdf_url=pmc_url, char_count=len(text),
                       error="no JATS body (PMC record has no open full text)")
        return {"ok": False, "status": "not_oa",
                "error": f"no open full-text body ({len(text)} chars)",
                "post_id": post_id, "source": source, "pdf_url": pmc_url,
                "char_count": len(text)}

    return _finalize_text(post_id, source, text, cache, pdf_url=pmc_url)


# ── Public API ────────────────────────────────────────────────────────────


def get_full_text(post_id: str, *, force: bool = False) -> dict[str, Any]:
    """Return the full text for a paper post, downloading + caching on first
    call. Subsequent calls hit the file cache and return in <5 ms.

    Returns:
        {
          ok: bool,
          status: 'ok' | 'empty' | 'not_oa' | 'download_failed'
                  | 'parse_failed' | 'unsupported',
          char_count: int,
          text: str,            # full extracted text, present when ok
          cached: bool,         # True if served from disk cache
          source: str,
          pdf_url: str,
          post_id: str,
          error: str,           # populated on failure
        }
    """
    db = get_db()
    rows = list(db.query(
        "SELECT id, title, coalesce(selftext,'') AS abstract,"
        " coalesce(source_type,'reddit') AS source,"
        " coalesce(url,'') AS url"
        " FROM posts WHERE id = ?",
        [post_id],
    ))
    if not rows:
        return {"ok": False, "status": "not_found", "error": f"no post {post_id}",
                "post_id": post_id}
    p = rows[0]
    source = (p["source"] or "reddit").lower()

    if source not in ("arxiv", "openalex", "semantic_scholar", "scholar", "pubmed"):
        return {"ok": False, "status": "unsupported",
                "error": f"source {source!r} has no full-text resolver",
                "post_id": post_id, "source": source}

    cache = _cache_path(source, post_id)
    if cache.exists() and not force:
        try:
            text = cache.read_text(encoding="utf-8")
            # Treat a 0-byte / sub-min cache as a miss, not a hit. A prior
            # run can have written an empty file when pypdf returned <200
            # chars (encrypted / image-only PDF) — we'd rather re-attempt
            # on demand than report `ok` with empty text every time.
            if len(text) >= MIN_USEFUL_CHARS:
                return {
                    "ok": True, "status": "ok", "cached": True,
                    "post_id": post_id, "source": source,
                    "char_count": len(text), "text": text,
                    "cache_path": str(cache),
                }
            else:
                cache.unlink(missing_ok=True)
        except OSError:
            # Cache file is corrupt — nuke and re-fetch.
            cache.unlink(missing_ok=True)

    # Pull metadata if the posts table actually has the column (older
    # schemas don't — the original `init_schema` never declared it). Use a
    # try/except rather than a feature-detect SELECT because sqlite-utils'
    # query() raises OperationalError on first missing-column access and
    # we don't want a hard dependency on a schema migration just to fetch
    # PDFs. When metadata isn't available we just lose the OA URL hint
    # and fall back to whatever's in `posts.url` — same behaviour as
    # arxiv-only callers had before.
    metadata: dict = {}
    try:
        meta_rows = list(db.query(
            "SELECT metadata_json FROM posts WHERE id = ?", [post_id],
        ))
        if meta_rows and meta_rows[0].get("metadata_json"):
            metadata = json.loads(meta_rows[0]["metadata_json"]) or {}
    except sqlite3.OperationalError as e:
        # Either the column doesn't exist on this schema OR the JSON was
        # malformed. Either way, proceed without metadata.
        if "no such column" not in str(e).lower():
            # A real DB error, not a missing-column one — surface it via
            # the status row so it's debuggable, but don't crash the tool.
            _record_status(post_id, source, "download_failed",
                           error=f"metadata read failed: {e}")
    except (ValueError, TypeError):
        metadata = {}

    # PubMed has no PDF in posts.url — route it through the PMC JATS branch,
    # which resolves PMID→PMCID→open full-text body and feeds the same cache
    # + return contract as the PDF path. Fails soft to not_oa for closed
    # papers (no regression — they stay abstract-only).
    if source == "pubmed":
        return _pubmed_full_text(post_id, source, p["url"], metadata, cache)

    pdf_url = _resolve_pdf_url(source, p["url"], post_id, metadata)
    if not pdf_url:
        _record_status(post_id, source, "not_oa")
        return {"ok": False, "status": "not_oa",
                "error": "no PDF URL available for this source/post",
                "post_id": post_id, "source": source}

    # Download to a temp file, parse, persist. Use a per-call temp filename
    # so concurrent calls on different posts don't collide.
    tmp = cache.with_suffix(".pdf.tmp")
    ok, err = _download_pdf(pdf_url, tmp)
    if not ok:
        tmp.unlink(missing_ok=True)
        _record_status(post_id, source, "download_failed",
                       pdf_url=pdf_url, error=err)
        return {"ok": False, "status": "download_failed", "error": err,
                "post_id": post_id, "source": source, "pdf_url": pdf_url}

    text, perr = _extract_text(tmp)
    tmp.unlink(missing_ok=True)
    if perr:
        _record_status(post_id, source, "parse_failed",
                       pdf_url=pdf_url, error=perr)
        return {"ok": False, "status": "parse_failed", "error": perr,
                "post_id": post_id, "source": source, "pdf_url": pdf_url}
    text = (text or "").strip()
    if len(text) < MIN_USEFUL_CHARS:
        _record_status(post_id, source, "empty",
                       pdf_url=pdf_url, char_count=len(text),
                       error="extracted < 200 chars (image-only or encrypted PDF?)")
        return {"ok": False, "status": "empty",
                "error": f"only {len(text)} chars extracted",
                "post_id": post_id, "source": source, "pdf_url": pdf_url,
                "char_count": len(text)}

    return _finalize_text(post_id, source, text, cache, pdf_url=pdf_url)


def _auto_index_after_download(post_id: str) -> None:
    """Run the section/chunk/reference pipeline on a freshly-cached paper.

    Each step is wrapped in its own try/except — a failure in one
    (e.g. chromadb missing for embedding) doesn't block the others
    (e.g. references can still extract). All steps are idempotent so
    a re-run after a fix doesn't double-write.
    """
    try:
        from .paper_sections import parse_sections_for
        parse_sections_for(post_id, force=False)
    except Exception:
        pass
    try:
        from .paper_chunks import chunk_paper
        chunk_paper(post_id, force=False, embed=True)
    except Exception:
        pass
    try:
        from .paper_references import extract_references_for, resolve_to_existing_posts
        extract_references_for(post_id, force=False)
        resolve_to_existing_posts(post_id)
    except Exception:
        pass


def get_full_text_or_abstract(post_id: str, *, max_chars: int = 30_000) -> dict[str, Any]:
    """Convenience wrapper for callers (LLM analyzers) that want the best
    available content WITHOUT having to branch on availability. Tries full
    text first; falls back to the post's abstract; returns whichever's
    available with a `tier` flag so the caller knows what they got."""
    full = get_full_text(post_id)
    if full.get("ok"):
        text = full["text"]
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[truncated to fit context]"
        return {"ok": True, "tier": "full_text", "text": text,
                "char_count": len(text), "source": full["source"]}

    db = get_db()
    rows = list(db.query(
        "SELECT title, coalesce(selftext,'') AS abstract,"
        " coalesce(source_type,'reddit') AS source"
        " FROM posts WHERE id = ?",
        [post_id],
    ))
    if not rows:
        return {"ok": False, "tier": "none", "text": "",
                "error": f"no post {post_id}"}
    abstract = (rows[0]["abstract"] or "").strip()
    return {
        "ok": bool(abstract),
        "tier": "abstract" if abstract else "title_only",
        "text": abstract,
        "char_count": len(abstract),
        "source": rows[0]["source"],
        "fallback_reason": full.get("status"),
    }


def fetch_bulk(
    *,
    topic: str | None = None,
    sources: list[str] | None = None,
    limit: int | None = None,
    skip_failed: bool = True,
    progress: Any | None = None,
) -> dict[str, Any]:
    """Walk all paper rows for a topic (or every topic when topic=None)
    and fetch full text for any that don't already have a cached row.

    `skip_failed=True` (default) skips posts whose paper_full_texts row is
    in a permanent-failure state (not_oa / download_failed / parse_failed
    / empty) so we don't retry forever. Pass force=True per-post via
    `get_full_text(force=True)` to retry.

    `progress` (optional) is called as ``progress(i, total, post_id, status)``
    after each paper so a streaming caller (the in-app workflow) can show
    live "downloading 47/180" counts. A broken callback never breaks the batch.
    """
    _ensure_table()
    db = get_db()
    src_list = sources or ["arxiv", "openalex", "semantic_scholar", "scholar", "pubmed"]
    src_placeholders = ",".join(["?"] * len(src_list))
    params: list[Any] = list(src_list)

    sql = (
        "SELECT p.id, p.source_type FROM posts p"
        " WHERE p.source_type IN (" + src_placeholders + ")"
    )
    if topic:
        sql += (
            " AND p.id IN ("
            "  SELECT post_id FROM topic_posts WHERE topic = ?"
            " )"
        )
        params.append(topic)
    if skip_failed:
        sql += (
            " AND p.id NOT IN ("
            "  SELECT post_id FROM paper_full_texts"
            "  WHERE status IN ('ok','not_oa','download_failed','parse_failed','empty','unsupported')"
            " )"
        )
    sql += " ORDER BY p.created_utc DESC"
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))

    try:
        targets = list(db.query(sql, params))
    except Exception as e:
        return {"ok": False, "error": f"corpus query failed: {e}"}

    total = len(targets)
    out = {"ok": True, "topic": topic, "total": total,
           "fetched": 0, "skipped": 0, "failed": 0,
           "by_status": {}}
    for i, t in enumerate(targets, 1):
        r = get_full_text(t["id"])
        st = r.get("status", "unknown")
        out["by_status"][st] = out["by_status"].get(st, 0) + 1
        if r.get("ok"):
            out["fetched"] += 1
        elif st in ("not_oa", "unsupported"):
            out["skipped"] += 1
        else:
            out["failed"] += 1
        if progress:
            try:
                progress(i, total, t["id"], st)
            except Exception:
                pass
        # Light politeness — don't hammer arxiv/openalex.
        time.sleep(0.3)
    return out


def get_status_summary(topic: str | None = None) -> dict[str, Any]:
    """Aggregate paper_full_texts by status — for `mcp paper-fulltext stats`
    and the desktop app's research panel."""
    _ensure_table()
    db = get_db()
    if topic:
        rows = list(db.query(
            "SELECT pft.status, count(*) AS n"
            " FROM paper_full_texts pft"
            " JOIN topic_posts tp ON tp.post_id = pft.post_id"
            " WHERE tp.topic = ? GROUP BY pft.status",
            [topic],
        ))
    else:
        rows = list(db.query(
            "SELECT status, count(*) AS n FROM paper_full_texts GROUP BY status"
        ))
    return {"topic": topic, "by_status": {r["status"]: int(r["n"]) for r in rows}}
