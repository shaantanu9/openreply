"""PubMed via NCBI E-utilities. Free, optional API key for higher quota.

https://www.ncbi.nlm.nih.gov/books/NBK25501/
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _get(path: str, params: dict[str, Any]) -> str | None:
    from ._http import DEFAULT_HEADERS
    key = os.getenv("NCBI_API_KEY")
    if key:
        params = {**params, "api_key": key}
    try:
        r = httpx.get(f"{_BASE}{path}", params=params, timeout=20, headers=DEFAULT_HEADERS)
        r.raise_for_status()
        return r.text
    except httpx.HTTPError:
        return None


def _parse_summary(xml: str) -> list[dict]:
    rows: list[dict] = []
    docs = re.findall(r"<DocSum>(.*?)</DocSum>", xml, re.DOTALL)
    for d in docs:
        uid = re.search(r"<Id>(\d+)</Id>", d)
        if not uid:
            continue
        pid = uid.group(1)
        title = re.search(r'<Item Name="Title"[^>]*>(.*?)</Item>', d, re.DOTALL)
        pub_date = re.search(r'<Item Name="PubDate"[^>]*>(.*?)</Item>', d)
        authors_xml = re.search(r'<Item Name="AuthorList"[^>]*>(.*?)</Item>', d, re.DOTALL)
        authors = (
            re.findall(r'<Item Name="Author"[^>]*>(.*?)</Item>', authors_xml.group(1))
            if authors_xml else []
        )
        source = re.search(r'<Item Name="Source"[^>]*>(.*?)</Item>', d)
        try:
            year = int((pub_date.group(1) if pub_date else "")[:4])
            ts = datetime(year, 1, 1, tzinfo=timezone.utc).timestamp()
        except (ValueError, AttributeError):
            ts = 0.0
        rows.append(
            {
                "id": f"pubmed_{pid}",
                "sub": "pubmed",
                "source_type": "pubmed",
                "author": ", ".join(authors[:3]) or "[unknown]",
                "title": (title.group(1) if title else "").strip(),
                "selftext": "",
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pid}/",
                "score": 0,
                "upvote_ratio": None,
                "num_comments": 0,
                "created_utc": ts,
                "is_self": 1,
                "over_18": 0,
                "flair": source.group(1) if source else None,
                "permalink": f"https://pubmed.ncbi.nlm.nih.gov/{pid}/",
                "fetched_at": _now_iso(),
            }
        )
    return rows


def fetch_pubmed(query: str, limit: int = 30) -> list[dict]:
    # 1. esearch to get IDs
    es = _get("/esearch.fcgi", {"db": "pubmed", "term": query, "retmax": min(200, limit), "retmode": "json"})
    if not es:
        return []
    import json
    try:
        ids = (json.loads(es).get("esearchresult") or {}).get("idlist") or []
    except json.JSONDecodeError:
        return []
    if not ids:
        return []
    time.sleep(0.34)  # NCBI asks for <3 req/sec without key
    # 2. esummary for metadata
    summary = _get("/esummary.fcgi", {"db": "pubmed", "id": ",".join(ids[:limit])})
    if not summary:
        return []
    return _parse_summary(summary)
