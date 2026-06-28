"""GDELT DOC 2.0 — free global news/event database, no API key.

Pure-httpx REST against the public DOC API (no `gdeltdoc`/pandas dep, so
it's sidecar-safe). Structured global news with date-range support — the
one miroclaw finance source with broad value for OpenReply: event-driven
topics + historical news backfill + forecast-engine ground truth.

Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx

from ._http import polite_get
from ._extra_common import text_row

_API = "https://api.gdeltproject.org/api/v2/doc/doc"


def _get_articles(params: dict) -> list:
    """GDELT throttles bursts (HTTP 200 + non-JSON / empty body) and is often
    slow. Fail-fast: short per-call timeout + one brief retry, so a throttled
    GDELT can't pin a slot in the parallel aggressive sweep — it just returns
    [] within ~15s worst case."""
    for attempt in range(2):
        try:
            r = polite_get(_API, params=params, timeout=10.0)
            r.raise_for_status()
            data = r.json()
            arts = data.get("articles") or []
            if arts:
                return arts
        except (httpx.HTTPError, ValueError):
            pass
        if attempt == 0:
            time.sleep(3.0)  # brief back-off past the throttle window
    return []


def _parse_seendate(s: str) -> float:
    # GDELT seendate looks like "20240115T123000Z".
    try:
        dt = datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def fetch_gdelt(
    query: str,
    limit: int = 50,
    *,
    country: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """Search global news. `country` is an optional FIPS code (e.g. 'IN', 'US').

    `start_date`/`end_date` are ISO YYYY-MM-DD; when given, queries that window.
    Never raises — returns [] on any error.
    """
    q = query.strip()
    if country:
        q = f'{q} sourcecountry:{country}'
    params: dict[str, str] = {
        "query": q,
        "mode": "ArtList",
        "format": "json",
        "maxrecords": str(min(max(limit, 1), 250)),
        "sort": "DateDesc",
    }
    if start_date:
        params["startdatetime"] = start_date.replace("-", "") + "000000"
        params["enddatetime"] = (
            (end_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")).replace("-", "") + "235959"
        )
    arts = _get_articles(params)
    rows: list[dict] = []
    for a in arts[:limit]:
        title = a.get("title") or ""
        if not title:
            continue
        domain = a.get("domain") or ""
        rows.append(
            text_row(
                "gdelt",
                ident=a.get("url") or title,
                title=title,
                body=f"{title}\n\nSource: {domain} ({a.get('sourcecountry', '')})",
                url=a.get("url") or "",
                ts=_parse_seendate(a.get("seendate") or ""),
                sub=(domain or "gdelt")[:60],
                author=domain,
            )
        )
    return rows
