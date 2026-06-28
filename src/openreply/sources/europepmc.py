"""Europe PMC — biomedical + life-science literature, preprints (bioRxiv/medRxiv),
agricola and patents. Free, no key, very reliable. Broader than PubMed (it also
indexes preprints + non-MEDLINE sources).

https://europepmc.org/RestfulWebService
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(r: dict[str, Any]) -> dict[str, Any]:
    src = r.get("source") or "MED"
    pid = r.get("id") or ""
    try:
        year = int(str(r.get("pubYear") or "0")[:4])
    except (ValueError, TypeError):
        year = 0
    ts = datetime(year, 1, 1, tzinfo=timezone.utc).timestamp() if year else 0.0
    if pid:
        url = f"https://europepmc.org/article/{src}/{pid}"
    elif r.get("doi"):
        url = f"https://doi.org/{r['doi']}"
    else:
        url = ""
    return {
        "id": f"epmc_{src}_{pid}",
        "sub": "europepmc",
        "source_type": "europepmc",
        "author": (r.get("authorString") or "[unknown]")[:300],
        "title": (r.get("title") or "")[:300],
        "selftext": (r.get("abstractText") or "")[:2000],
        "url": url,
        "score": int(r.get("citedByCount") or 0),
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": r.get("journalTitle") or r.get("source"),
        # permalink left None: `url` holds the real link; storing a non-reddit
        # URL in permalink makes the FE prepend reddit.com (broken links).
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_europepmc(query: str, limit: int = 30) -> list[dict]:
    params: dict[str, Any] = {
        "query": query,
        "format": "json",
        "pageSize": min(100, limit),
        "resultType": "core",  # includes abstractText
    }
    try:
        r = httpx.get(_BASE, params=params, timeout=20)
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    data = r.json() or {}
    results = (data.get("resultList") or {}).get("result") or []
    return [_row(x) for x in results][:limit]
