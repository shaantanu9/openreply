"""Semantic Scholar Graph API — citation counts, influential-citation metric,
and cross-discipline coverage (~220M papers). Free tier, no key required;
optional S2_API_KEY env var raises the rate limit from 100/5min to 5000/5min.

Row shape mirrors the other paper sources (arxiv / pubmed / openalex / scholar):
every paper lands in `posts` with `source_type='semantic_scholar'`, so they
flow through Palace, the graph, and the Solutions Agent like any other post.

The S2 Graph API is richer than Scholar (citation graphs + influential
citations + TLDR summaries), more open than OpenAlex (no auth dance), and
stabler than the Scholar scraper. Use when you want 'what cites this paper'
or 'what are the highest-signal papers on X'.

API docs: https://api.semanticscholar.org/api-docs/graph
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://api.semanticscholar.org/graph/v1"

# Only the fields we keep in posts.{title,selftext,url,score,author,created_utc}.
# `tldr` is S2's auto-generated summary — valuable signal, cheap to fetch.
_FIELDS = (
    "title,abstract,authors,year,citationCount,influentialCitationCount,"
    "openAccessPdf,externalIds,venue,tldr"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(p: dict[str, Any]) -> dict[str, Any]:
    title = (p.get("title") or "")[:300]
    abstract = (p.get("abstract") or "")[:2000]
    tldr = ((p.get("tldr") or {}) or {}).get("text") or ""
    body = abstract or tldr
    year = p.get("year") or 0
    try:
        ts = datetime(int(year), 1, 1, tzinfo=timezone.utc).timestamp() if year else 0
    except ValueError:
        ts = 0
    authors_list = [(a.get("name") or "") for a in (p.get("authors") or [])[:4]]
    authors = ", ".join([a for a in authors_list if a]) or "[unknown]"
    paper_id = p.get("paperId") or ""
    doi = ((p.get("externalIds") or {}) or {}).get("DOI")
    oa = (p.get("openAccessPdf") or {}) or {}
    url = oa.get("url") or (
        f"https://doi.org/{doi}" if doi else f"https://www.semanticscholar.org/paper/{paper_id}"
    )
    venue = p.get("venue") or ""
    # `score` is the citation count so the graph/ranker surfaces high-signal
    # papers just like upvoted Reddit posts. `upvote_ratio` carries the
    # influential-citation fraction — a proxy for "how much of the citations
    # are actually built-upon vs. perfunctory".
    citations = p.get("citationCount") or 0
    influential = p.get("influentialCitationCount") or 0
    ratio = (influential / citations) if citations else 0.0
    return {
        "id": f"s2_{paper_id}",
        "sub": "semantic_scholar",
        "source_type": "semantic_scholar",
        "author": authors,
        "title": f"{title}  — {venue}" if venue else title,
        "selftext": body,
        "url": url,
        "score": int(citations),
        "upvote_ratio": round(ratio, 3),
        "num_comments": int(influential),
        "created_utc": ts,
        "is_self": 1,
        "over_18": 0,
        "flair": f"cites={citations} · influential={influential}",
        "permalink": f"https://www.semanticscholar.org/paper/{paper_id}" if paper_id else "",
        "fetched_at": _now_iso(),
    }


def fetch_semantic_scholar(
    query: str,
    limit: int = 30,
    year_from: int | None = None,
    open_access_only: bool = False,
) -> list[dict]:
    """Search Semantic Scholar and return rows ready for `upsert_posts`.

    Args:
        query: free-text search — meaning-matches beat keyword-only search
            because S2 uses learned embeddings internally.
        limit: max papers (capped at 100 per call; paginate in the caller
            if you need more).
        year_from: exclude pre-`year_from` papers. Useful for "what's new
            since 2020".
        open_access_only: only return papers with an openAccessPdf URL.

    Returns `[]` on transport errors / rate limits — matches the other
    source fetchers so collect pipelines don't explode on network blips.
    """
    headers = {"User-Agent": "openreply/0.1"}
    key = os.environ.get("S2_API_KEY")
    if key:
        headers["x-api-key"] = key

    params: dict[str, Any] = {
        "query": query,
        "limit": min(100, max(1, limit)),
        "fields": _FIELDS,
    }
    if year_from:
        params["year"] = f"{year_from}-"
    if open_access_only:
        params["openAccessPdf"] = ""

    try:
        r = httpx.get(
            f"{_BASE}/paper/search",
            params=params,
            headers=headers,
            timeout=30.0,
        )
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return []

    papers = data.get("data") or []
    rows: list[dict] = []
    for p in papers:
        try:
            rows.append(_row(p))
        except Exception:  # noqa: BLE001
            continue
    return rows


def fetch_citations(paper_id: str, limit: int = 30) -> list[dict]:
    """Papers that cite `paper_id`. Accepts S2 paper_id, DOI, or arXiv id.

    Returns row-shaped papers (same as `fetch_semantic_scholar`) so callers
    can upsert them directly. Powerful for "who built on this?" — the core
    literature-review move that plain search can't do.
    """
    headers = {"User-Agent": "openreply/0.1"}
    if os.environ.get("S2_API_KEY"):
        headers["x-api-key"] = os.environ["S2_API_KEY"]

    # S2 accepts bare DOI (10.xxxx/...), arXiv (ARXIV:2310.12345), or paperId.
    pid = paper_id
    if paper_id.startswith("s2_"):
        pid = paper_id[3:]

    try:
        r = httpx.get(
            f"{_BASE}/paper/{pid}/citations",
            params={"limit": min(100, max(1, limit)), "fields": f"citingPaper.{_FIELDS.replace(',', ',citingPaper.')}"},
            headers=headers,
            timeout=30.0,
        )
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return []

    rows: list[dict] = []
    for entry in (data.get("data") or []):
        cp = entry.get("citingPaper") or {}
        try:
            rows.append(_row(cp))
        except Exception:  # noqa: BLE001
            continue
    return rows


def fetch_references(paper_id: str, limit: int = 30) -> list[dict]:
    """Papers cited BY `paper_id` — the reference list. Walk this to do
    backward literature review."""
    headers = {"User-Agent": "openreply/0.1"}
    if os.environ.get("S2_API_KEY"):
        headers["x-api-key"] = os.environ["S2_API_KEY"]

    pid = paper_id[3:] if paper_id.startswith("s2_") else paper_id
    try:
        r = httpx.get(
            f"{_BASE}/paper/{pid}/references",
            params={"limit": min(100, max(1, limit)), "fields": f"citedPaper.{_FIELDS.replace(',', ',citedPaper.')}"},
            headers=headers,
            timeout=30.0,
        )
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return []

    rows: list[dict] = []
    for entry in (data.get("data") or []):
        rp = entry.get("citedPaper") or {}
        try:
            rows.append(_row(rp))
        except Exception:  # noqa: BLE001
            continue
    return rows


def fetch_reference_ids(paper_id: str, limit: int = 100) -> list[dict] | None:
    """Reference list of `paper_id` as lightweight id rows (NOT post-shaped):
    ``[{paperId, doi, arxiv, pmid, title, year}, …]``. Accepts an S2 paperId,
    DOI, arXiv, or PMID id. Returns None on hard error (so callers can tell
    "no references" from "fetch failed"). Used to build paper→paper `cites`
    edges by matching these external ids against the in-corpus papers."""
    headers = {"User-Agent": "openreply/0.1"}
    if os.environ.get("S2_API_KEY"):
        headers["x-api-key"] = os.environ["S2_API_KEY"]
    pid = paper_id[3:] if paper_id.startswith("s2_") else paper_id
    params = {"limit": min(1000, max(1, limit)),
              "fields": "citedPaper.externalIds,citedPaper.title,citedPaper.year,citedPaper.paperId"}
    # S2's unauthenticated quota is tiny — honour Retry-After on 429 with a
    # capped single retry (set S2_API_KEY for any sizeable run).
    data = None
    for _attempt in range(2):
        try:
            r = httpx.get(f"{_BASE}/paper/{pid}/references",
                          params=params, headers=headers, timeout=30.0)
            if r.status_code == 429:
                wait = 0.0
                try:
                    wait = float(r.headers.get("Retry-After") or 0)
                except ValueError:
                    wait = 0.0
                time.sleep(min(max(wait, 2.0), 15.0))
                continue
            r.raise_for_status()
            data = r.json() or {}
            break
        except (httpx.HTTPError, ValueError):
            return None
    if data is None:
        return None
    out: list[dict] = []
    for entry in (data.get("data") or []):
        cp = entry.get("citedPaper") or {}
        ext = (cp.get("externalIds") or {}) or {}
        out.append({
            "paperId": cp.get("paperId") or "",
            "doi": (ext.get("DOI") or "").lower(),
            "arxiv": ext.get("ArXiv") or "",
            "pmid": str(ext.get("PubMed") or ""),
            "title": cp.get("title") or "",
            "year": cp.get("year") or 0,
        })
    return out


def fetch_abstract(paper_id: str) -> str | None:
    """Fetch ONE S2 paper's abstract (or TLDR fallback) by id. Accepts an S2
    paperId, DOI, or arXiv id. Returns None on miss / no abstract. Used by
    abstract-enrichment to backfill title-only papers."""
    headers = {"User-Agent": "openreply/0.1"}
    if os.environ.get("S2_API_KEY"):
        headers["x-api-key"] = os.environ["S2_API_KEY"]
    pid = paper_id[3:] if paper_id.startswith("s2_") else paper_id
    try:
        r = httpx.get(
            f"{_BASE}/paper/{pid}",
            params={"fields": "abstract,tldr"},
            headers=headers,
            timeout=30.0,
        )
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return None
    body = (data.get("abstract") or "") or (((data.get("tldr") or {}) or {}).get("text") or "")
    return (body.strip()[:2000] or None) if body else None
