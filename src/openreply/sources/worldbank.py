"""World Bank Open Data — country macro indicators, no API key.

Pure-httpx REST (no `wbgapi` dep). Annual macro series (GDP growth, CPI,
unemployment, trade, FDI…) rendered as text-summary posts. Domain value
is narrow — mainly market-sizing / TAM context — so it's opt-in, not in
the default sweep.

Docs: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ._http import polite_get
from ._extra_common import text_row

# Major-economy name → ISO-3 (World Bank uses ISO-3 / 2-letter both work).
_COUNTRY_ALIASES = {
    "india": "IND", "united states": "USA", "usa": "USA", "us": "USA",
    "china": "CHN", "japan": "JPN", "uk": "GBR", "united kingdom": "GBR",
    "germany": "DEU", "world": "WLD",
}

_INDICATORS = {
    "NY.GDP.MKTP.KD.ZG": "GDP growth (annual %)",
    "FP.CPI.TOTL.ZG": "Inflation, consumer prices (annual %)",
    "NY.GDP.PCAP.CD": "GDP per capita (US$)",
    "SL.UEM.TOTL.ZS": "Unemployment (% labor force)",
    "NE.TRD.GNFS.ZS": "Trade (% of GDP)",
    "BX.KLT.DINV.WD.GD.ZS": "FDI net inflows (% of GDP)",
    "SP.POP.TOTL": "Population, total",
}


def _resolve_country(query: str) -> str:
    q = (query or "").strip().lower()
    for name, iso in _COUNTRY_ALIASES.items():
        if name in q:
            return iso
    return "USA"


def fetch_worldbank(query: str, limit: int = 7, *, country: str | None = None) -> list[dict]:
    """One row per macro indicator (latest value + recent trend). Never raises."""
    iso = (country or _resolve_country(query)).upper()
    year_to = datetime.now(timezone.utc).year
    rows: list[dict] = []
    for code, label in list(_INDICATORS.items())[:limit]:
        url = f"https://api.worldbank.org/v2/country/{iso}/indicator/{code}"
        try:
            r = polite_get(url, params={"format": "json", "per_page": "8",
                                        "date": f"{year_to-7}:{year_to}"})
            r.raise_for_status()
            payload = r.json()
        except (httpx.HTTPError, ValueError):
            continue
        if not isinstance(payload, list) or len(payload) < 2 or not payload[1]:
            continue
        series = [d for d in payload[1] if d.get("value") is not None]
        if not series:
            continue
        latest = series[0]
        trend = ", ".join(f"{d['date']}: {d['value']}" for d in series[:6])
        cname = (latest.get("country") or {}).get("value") or iso
        rows.append(
            text_row(
                "worldbank",
                ident=f"{iso}:{code}",
                title=f"{cname} — {label}: {latest['value']} ({latest['date']})",
                body=f"{cname} {label}. Recent: {trend}. Source: World Bank ({code}).",
                url=f"https://data.worldbank.org/indicator/{code}?locations={iso[:2]}",
                ts=_year_ts(latest.get("date")),
                sub=f"worldbank:{iso.lower()}",
                author="World Bank",
            )
        )
    return rows


def _year_ts(year: str | None) -> float:
    try:
        return datetime(int(year), 12, 31, tzinfo=timezone.utc).timestamp()
    except Exception:
        return 0.0
