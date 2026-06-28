"""BIS (Bank for International Settlements) — central-bank policy rates, no key.

Pure-httpx against the BIS SDMX REST API (CSV), parsed with the stdlib
`csv` module (no pandas). Monthly central-bank policy rates per country,
rendered as text-summary posts. Niche domain value (market-sizing/macro);
opt-in. BIS's SDMX schema shifts occasionally — on any deviation we skip
that country and return whatever parsed (never raise).

Docs: https://www.bis.org/statistics/
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

import httpx

from ._http import polite_get
from ._extra_common import text_row

# WS_CBPOL = central bank policy rates; key = FREQ.REF_AREA (M = monthly).
_FLOW = "WS_CBPOL"
_COUNTRIES = {"US": "United States", "XM": "Euro area", "GB": "United Kingdom",
              "JP": "Japan", "IN": "India", "CN": "China"}


def _ts(period: str) -> float:
    for fmt in ("%Y-%m", "%Y-%m-%d", "%Y"):
        try:
            return datetime.strptime(period, fmt).replace(tzinfo=timezone.utc).timestamp()
        except Exception:
            continue
    return 0.0


def fetch_bis(query: str, limit: int = 6) -> list[dict]:
    """One row per country policy rate (latest observation). Never raises."""
    rows: list[dict] = []
    for code, name in list(_COUNTRIES.items())[:limit]:
        url = f"https://stats.bis.org/api/v1/data/{_FLOW}/M.{code}/all"
        try:
            r = polite_get(url, params={"detail": "dataonly", "format": "csv"})
            r.raise_for_status()
            text = r.text
        except httpx.HTTPError:
            continue
        try:
            reader = list(csv.DictReader(io.StringIO(text)))
        except Exception:
            continue
        if not reader:
            continue
        # Find value + period columns (BIS uses OBS_VALUE / TIME_PERIOD).
        val_key = next((k for k in reader[0] if k.upper().endswith("OBS_VALUE")), None)
        per_key = next((k for k in reader[0] if "TIME_PERIOD" in k.upper()), None)
        if not val_key or not per_key:
            continue
        valid = [row for row in reader if (row.get(val_key) or "").strip()]
        if not valid:
            continue
        latest = valid[-1]
        recent = ", ".join(f"{row[per_key]}: {row[val_key]}" for row in valid[-6:])
        rows.append(
            text_row(
                "bis",
                ident=f"{code}:cbpol",
                title=f"{name} — central bank policy rate: {latest[val_key]}% ({latest[per_key]})",
                body=f"{name} policy rate. Recent: {recent}. Source: BIS ({_FLOW}).",
                url="https://www.bis.org/statistics/cbpol.htm",
                ts=_ts(latest[per_key]),
                sub=f"bis:{code.lower()}",
                author="BIS",
            )
        )
    return rows
