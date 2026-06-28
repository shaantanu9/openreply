"""ACLED — structured conflict/protest events. Free registration required.

Pure-httpx: OAuth2 password-grant token, then the events read endpoint.
Set ACLED_EMAIL + ACLED_PASSWORD (free at https://acleddata.com/register/).
No creds → []. Off-domain for product-gap discovery; included for
completeness and political/geo-risk topics. Each event → a posts row.

Docs: https://apidocs.acleddata.com/
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx

from ._extra_common import text_row

_TOKEN = "https://acleddata.com/oauth/token"
_READ = "https://acleddata.com/api/acled/read"


def _get_token(email: str, password: str) -> str | None:
    try:
        r = httpx.post(_TOKEN, data={
            "username": email, "password": password,
            "grant_type": "password", "client_id": "acled",
        }, timeout=25.0)
        r.raise_for_status()
        return (r.json() or {}).get("access_token")
    except (httpx.HTTPError, ValueError):
        return None


def _ts(d: str | None) -> float:
    try:
        return datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return 0.0


def fetch_acled(query: str, limit: int = 30, *, country: str | None = None) -> list[dict]:
    """Recent conflict/protest events matching the query. Never raises."""
    email = os.environ.get("ACLED_EMAIL")
    password = os.environ.get("ACLED_PASSWORD")
    if not email or not password:
        return []
    token = _get_token(email, password)
    if not token:
        return []
    params = {"limit": str(min(max(limit, 1), 100))}
    if country:
        params["country"] = country
    # Loose keyword filter on notes when the query is specific.
    if query and query.strip():
        params["notes"] = query.strip()
        params["notes_where"] = "LIKE"
    try:
        r = httpx.get(_READ, params=params,
                      headers={"Authorization": f"Bearer {token}"}, timeout=30.0)
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return []
    events = data.get("data") or []
    rows: list[dict] = []
    for ev in events[:limit]:
        etype = ev.get("event_type") or "event"
        loc = ev.get("location") or ev.get("admin1") or ""
        ctry = ev.get("country") or ""
        fatalities = ev.get("fatalities") or 0
        notes = ev.get("notes") or ""
        title = f"{etype} in {loc}, {ctry} ({fatalities} fatalities)".strip()
        rows.append(
            text_row(
                "acled",
                ident=str(ev.get("event_id_cnty") or ev.get("data_id") or notes[:40]),
                title=title,
                body=f"{notes}\n\n{ev.get('actor1', '')} vs {ev.get('actor2', '')}. "
                     f"Source: ACLED ({ev.get('source', '')}).",
                url=ev.get("source_scale") and "" or "https://acleddata.com/",
                ts=_ts(ev.get("event_date")),
                sub=f"acled:{(ctry or 'world').lower().replace(' ', '-')}",
                author=ev.get("source") or "ACLED",
                score=int(fatalities or 0),
            )
        )
    return rows
