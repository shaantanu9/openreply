"""Shared row builder for the miroclaw-derived external sources.

GDELT / DuckDuckGo / Tavily / World Bank / FRED / BIS / yfinance /
Open-Meteo / ACLED all emit the same common ``posts`` row shape so dedup,
graph, sentiment, audience clustering, and the forecast engine work on
them unchanged.

Numeric sources (World Bank, FRED, BIS, yfinance, Open-Meteo) have no
"post" — we render each datum as a short text summary in ``title`` +
``selftext`` (the same approach miroclaw uses for its DataResult.content),
so a macro indicator becomes a first-class row the rest of the pipeline
can read.

Rules baked in here (see SOURCE_ADDITION_PLAYBOOK.md):
  - ``permalink`` is always None for these non-Reddit sources (the
    frontend prepends reddit.com to a non-empty permalink → broken link;
    the real link lives in ``url``).
  - ``created_utc`` carries a real epoch timestamp whenever the source
    provides one — temporal split + the forecast engine depend on it.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _stable_id(ident: str) -> str:
    """Deterministic, cross-process stable hash for row IDs.

    Python's built-in ``hash()`` is randomized per process, so the same
    URL would get a different ``id`` on every run and break downstream
    deduplication. Use SHA-256 truncated to 16 hex chars instead.
    """
    return hashlib.sha256(ident.encode("utf-8")).hexdigest()[:16]


def text_row(
    source_type: str,
    *,
    ident: str,
    title: str,
    body: str = "",
    url: str = "",
    ts: float = 0.0,
    sub: str | None = None,
    author: str = "",
    score: int = 0,
    num_comments: int = 0,
) -> dict:
    """Build one common ``posts`` row from a text/numeric datum."""
    return {
        "id": f"{source_type}_{_stable_id(ident)}",
        "sub": (sub or source_type)[:60],
        "source_type": source_type,
        "author": (author or "")[:120],
        "title": (title or "")[:300],
        "selftext": (body or "")[:2000],
        "url": url or "",
        "score": int(score or 0),
        "upvote_ratio": None,
        "num_comments": int(num_comments or 0),
        "created_utc": float(ts or 0.0),
        "is_self": 0,
        "over_18": 0,
        "flair": None,
        "permalink": None,
        "fetched_at": _now_iso(),
    }
