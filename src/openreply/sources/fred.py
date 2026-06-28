"""FRED (St. Louis Fed) — US macro series. Free API key required.

Pure-httpx REST. Set FRED_API_KEY (free, instant:
https://fred.stlouisfed.org/docs/api/api_key.html). No key → []. Each
tracked series is rendered as a text-summary post (latest + trend).
Narrow domain value (market-sizing / macro context); opt-in.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx

from ._http import polite_get
from ._extra_common import text_row

_API = "https://api.stlouisfed.org/fred/series/observations"

_SERIES = {
    "FEDFUNDS": "US Federal Funds Rate (%)",
    "CPIAUCSL": "US CPI (All Urban Consumers)",
    "DGS10": "US 10-Year Treasury Yield (%)",
    "VIXCLS": "VIX Volatility Index",
    "UNRATE": "US Unemployment Rate (%)",
    "DCOILWTICO": "WTI Crude Oil ($/bbl)",
}


def fetch_fred(query: str, limit: int = 6) -> list[dict]:
    """One row per tracked US macro series. Never raises."""
    key = os.environ.get("FRED_API_KEY")
    if not key:
        return []
    rows: list[dict] = []
    for sid, label in list(_SERIES.items())[:limit]:
        try:
            r = polite_get(_API, params={
                "series_id": sid, "api_key": key, "file_type": "json",
                "sort_order": "desc", "limit": "8",
            })
            r.raise_for_status()
            obs = (r.json() or {}).get("observations") or []
        except (httpx.HTTPError, ValueError):
            continue
        obs = [o for o in obs if o.get("value") not in (None, ".", "")]
        if not obs:
            continue
        latest = obs[0]
        trend = ", ".join(f"{o['date']}: {o['value']}" for o in obs[:6])
        rows.append(
            text_row(
                "fred",
                ident=sid,
                title=f"{label}: {latest['value']} ({latest['date']})",
                body=f"{label}. Recent: {trend}. Source: FRED ({sid}).",
                url=f"https://fred.stlouisfed.org/series/{sid}",
                ts=_iso_ts(latest.get("date")),
                sub="fred",
                author="FRED",
            )
        )
    return rows


def _iso_ts(d: str | None) -> float:
    try:
        return datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return 0.0
