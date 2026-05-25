"""Google Trends via pytrends. Writes to `trend_series` table (time series).

Trends data isn't posts — it's a demand-validation overlay. Stored separately
from `posts` so the graph stays text-evidence-only; the report layer pulls
trends curves to answer "is this pain growing or fading?"
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _require_pytrends():
    try:
        # pytrends 4.9.2 passes `method_whitelist` to urllib3's Retry, which
        # was renamed to `allowed_methods` in urllib3 2.x. Shim before import.
        from urllib3.util.retry import Retry

        _orig_init = Retry.__init__

        def _patched_init(self, *args, **kwargs):
            if "method_whitelist" in kwargs:
                kwargs["allowed_methods"] = kwargs.pop("method_whitelist")
            return _orig_init(self, *args, **kwargs)

        if getattr(Retry.__init__, "_patched_for_pytrends", False) is False:
            Retry.__init__ = _patched_init  # type: ignore[assignment]
            Retry.__init__._patched_for_pytrends = True  # type: ignore[attr-defined]

        from pytrends.request import TrendReq  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "Install the sources extra: pip install -e '.[sources]'"
        ) from e
    return TrendReq


def fetch_trends(
    topic: str,
    keywords: list[str] | None = None,
    timeframe: str = "today 5-y",   # today 5-y, today 12-m, today 3-m, ...
    geo: str = "",                  # "" = worldwide, "US", "IN", etc.
    save: bool = True,
) -> dict[str, Any]:
    """Pull Google Trends interest-over-time for a topic.

    Returns:
        {
          "topic": str,
          "keywords": [str],
          "series": {keyword: [(date_iso, interest_0_100), ...]},
          "rising_queries": {keyword: [{"query": str, "value": int}, ...]},
          "top_queries":    {keyword: [{"query": str, "value": int}, ...]},
        }
    """
    TrendReq = _require_pytrends()
    kws = keywords or [topic]
    kws = kws[:5]  # pytrends caps at 5 keywords per request

    try:
        pt = TrendReq(hl="en-US", tz=360, retries=2, backoff_factor=0.5)
        pt.build_payload(kws, cat=0, timeframe=timeframe, geo=geo, gprop="")
        df = pt.interest_over_time()
        related = pt.related_queries()
    except Exception as e:
        return {"topic": topic, "error": str(e), "keywords": kws}

    series: dict[str, list[tuple[str, int]]] = {}
    if df is not None and not df.empty:
        for kw in kws:
            if kw in df.columns:
                series[kw] = [
                    (ts.isoformat()[:10], int(v))
                    for ts, v in df[kw].items()
                    if v is not None
                ]

    if save and series:
        db = get_db()
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rows = []
        for kw, points in series.items():
            for date_iso, interest in points:
                rows.append(
                    {
                        "topic": topic,
                        "keyword": kw,
                        "timeframe": timeframe,
                        "geo": geo or "WW",
                        "point_ts": date_iso,
                        "interest": interest,
                        "fetched_at": now,
                    }
                )
        if rows:
            db["trend_series"].insert_all(rows, ignore=True)

    def _unwrap(rel, key):
        out = {}
        for kw in kws:
            payload = (rel.get(kw) or {}).get(key)
            if payload is None:
                continue
            # related_queries returns a pandas DataFrame per keyword
            try:
                out[kw] = [
                    {"query": r["query"], "value": int(r["value"])}
                    for _, r in payload.head(10).iterrows()
                ]
            except Exception:
                out[kw] = []
        return out

    return {
        "topic": topic,
        "keywords": kws,
        "timeframe": timeframe,
        "geo": geo or "WW",
        "series": series,
        "rising_queries": _unwrap(related, "rising"),
        "top_queries": _unwrap(related, "top"),
    }
