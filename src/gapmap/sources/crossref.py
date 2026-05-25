"""Crossref REST API — authoritative DOI metadata + reference lists.

Crossref is the DOI registration agency for most scholarly publishers, so
it has the canonical publication metadata (journal, page range, authors,
funders, clinical trial numbers) that Semantic Scholar and OpenAlex get
second-hand. Free, no auth, generous rate limits if you set a mailto
contact (the "polite pool"): set the CROSSREF_MAILTO env var.

Use when:
  - You have a DOI and want the authoritative record
  - You want reference lists from a paywalled paper (Crossref has them
    even when the publisher doesn't expose them publicly)
  - You want funder / grant info (where the money came from) — unique to
    Crossref among the open sources

API docs: https://api.crossref.org/
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://api.crossref.org"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _date_ts(item: dict) -> float:
    """Best-available publication date → unix ts. Crossref stores dates as
    `[[year, month, day]]` parts; we take the first tuple."""
    for key in ("published-print", "published-online", "issued", "created"):
        parts = ((item.get(key) or {}).get("date-parts") or [[]])[0]
        if parts:
            try:
                y = int(parts[0])
                m = int(parts[1]) if len(parts) > 1 else 1
                d = int(parts[2]) if len(parts) > 2 else 1
                return datetime(y, m, d, tzinfo=timezone.utc).timestamp()
            except (ValueError, TypeError):
                continue
    return 0.0


def _authors(item: dict) -> str:
    names = []
    for a in (item.get("author") or [])[:4]:
        given = (a.get("given") or "").strip()
        family = (a.get("family") or "").strip()
        name = f"{given} {family}".strip() or (a.get("name") or "")
        if name:
            names.append(name)
    return ", ".join(names) or "[unknown]"


def _row(item: dict[str, Any]) -> dict[str, Any]:
    title = ((item.get("title") or [""])[0] or "")[:300]
    abstract = (item.get("abstract") or "")[:2000]
    # Crossref abstracts can contain JATS XML tags — strip crudely so embed
    # text is clean.
    if abstract and ("<" in abstract or ">" in abstract):
        import re as _re
        abstract = _re.sub(r"<[^>]+>", " ", abstract).strip()[:2000]
    doi = item.get("DOI") or ""
    container = (item.get("container-title") or [""])[0] or ""
    refs = int(item.get("references-count") or 0)
    cites = int(item.get("is-referenced-by-count") or 0)
    funder = ", ".join(f.get("name", "") for f in (item.get("funder") or [])[:3])
    return {
        "id": f"crossref_{doi}" if doi else f"crossref_{item.get('URL', '')[-24:]}",
        "sub": "crossref",
        "source_type": "crossref",
        "author": _authors(item),
        "title": f"{title}  — {container}" if container else title,
        "selftext": abstract + (f"\n\nFunder(s): {funder}" if funder else ""),
        "url": f"https://doi.org/{doi}" if doi else (item.get("URL") or ""),
        "score": cites,             # "how many times cited" — ranking signal
        "upvote_ratio": 0.0,
        "num_comments": refs,       # "how long is its bibliography"
        "created_utc": _date_ts(item),
        "is_self": 1,
        "over_18": 0,
        "flair": f"{item.get('type', '')} · cites={cites}",
        "permalink": f"https://doi.org/{doi}" if doi else "",
        "fetched_at": _now_iso(),
    }


def _headers() -> dict[str, str]:
    # Providing a mailto puts us in the "polite pool" with higher rate limits
    # and priority. If not set, we still get the public pool — just slower.
    mailto = os.environ.get("CROSSREF_MAILTO") or "gapmap@example.invalid"
    return {
        "User-Agent": f"gapmap/0.1 (mailto:{mailto})",
        "Accept": "application/json",
    }


def fetch_crossref(
    query: str,
    limit: int = 30,
    year_from: int | None = None,
    filter_type: str | None = None,   # e.g. 'journal-article' / 'book-chapter'
) -> list[dict]:
    """Search Crossref. Returns rows ready for `upsert_posts`."""
    params: dict[str, Any] = {
        "query": query,
        "rows": min(100, max(1, limit)),
        "select": "DOI,title,abstract,author,published-print,published-online,issued,"
                  "container-title,type,is-referenced-by-count,references-count,"
                  "funder,URL",
        "sort": "score",
    }
    filters = []
    if year_from:
        filters.append(f"from-pub-date:{year_from}")
    if filter_type:
        filters.append(f"type:{filter_type}")
    if filters:
        params["filter"] = ",".join(filters)

    try:
        r = httpx.get(f"{_BASE}/works", params=params, headers=_headers(), timeout=30.0)
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return []

    items = ((data.get("message") or {}).get("items") or [])
    rows: list[dict] = []
    for it in items:
        try:
            rows.append(_row(it))
        except Exception:  # noqa: BLE001
            continue
    return rows


def fetch_by_doi(doi: str) -> dict | None:
    """Pull the canonical Crossref record for one DOI. Returns a single row
    or None on miss / error."""
    doi = (doi or "").strip().replace("https://doi.org/", "")
    if not doi:
        return None
    try:
        r = httpx.get(f"{_BASE}/works/{doi}", headers=_headers(), timeout=30.0)
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return None
    item = data.get("message")
    if not isinstance(item, dict):
        return None
    try:
        return _row(item)
    except Exception:  # noqa: BLE001
        return None
