"""Open-Meteo — free weather (current + 1940+ archive), no API key.

Pure-httpx REST. Off-domain for product-gap discovery; included for
completeness and for climate/agri topics. Each city → a text-summary
post (temps + rainfall). Keyless and reliable.

Docs: https://open-meteo.com/en/docs
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ._http import polite_get
from ._extra_common import text_row

_FORECAST = "https://api.open-meteo.com/v1/forecast"
_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

# A few major cities; name-matched against the query, else a default set.
_CITIES = {
    "new delhi": (28.6139, 77.2090), "delhi": (28.6139, 77.2090),
    "mumbai": (19.0760, 72.8777), "bangalore": (12.9716, 77.5946),
    "new york": (40.7128, -74.0060), "london": (51.5074, -0.1278),
    "san francisco": (37.7749, -122.4194), "tokyo": (35.6762, 139.6503),
}
_DEFAULT = ["new delhi", "new york", "london"]


def _cities_for(query: str) -> list[str]:
    q = (query or "").lower()
    hits = [c for c in _CITIES if c in q]
    return hits or _DEFAULT


def fetch_openmeteo(query: str, limit: int = 5, *,
                    start_date: str | None = None,
                    end_date: str | None = None) -> list[dict]:
    """One row per city. Uses the archive API when a date range is given."""
    rows: list[dict] = []
    historical = bool(start_date)
    for city in _cities_for(query)[:limit]:
        lat, lon = _CITIES[city]
        params = {
            "latitude": str(lat), "longitude": str(lon),
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
            "timezone": "auto",
        }
        endpoint = _FORECAST
        if historical:
            endpoint = _ARCHIVE
            params["start_date"] = start_date
            params["end_date"] = end_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            r = polite_get(endpoint, params=params)
            r.raise_for_status()
            daily = (r.json() or {}).get("daily") or {}
        except (httpx.HTTPError, ValueError):
            continue
        tmax = [t for t in (daily.get("temperature_2m_max") or []) if t is not None]
        tmin = [t for t in (daily.get("temperature_2m_min") or []) if t is not None]
        rain = [p for p in (daily.get("precipitation_sum") or []) if p is not None]
        if not tmax:
            continue
        avg_hi = sum(tmax) / len(tmax)
        avg_lo = (sum(tmin) / len(tmin)) if tmin else 0.0
        total_rain = sum(rain)
        rows.append(
            text_row(
                "openmeteo",
                ident=f"{city}:{start_date or 'now'}",
                title=f"{city.title()} weather — avg {avg_lo:.0f}–{avg_hi:.0f}°C, {total_rain:.0f}mm rain",
                body=(f"{city.title()}: avg high {avg_hi:.1f}°C, avg low {avg_lo:.1f}°C, "
                      f"total precipitation {total_rain:.1f}mm over {len(tmax)} days. "
                      f"Source: Open-Meteo ({'archive' if historical else 'forecast'})."),
                url="https://open-meteo.com/",
                ts=datetime.now(timezone.utc).timestamp(),
                sub=f"openmeteo:{city.replace(' ', '-')}",
                author="Open-Meteo",
            )
        )
    return rows
