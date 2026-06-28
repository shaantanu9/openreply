"""Yahoo Finance — stock/index/commodity quotes, no API key.

Pure-httpx against the public Yahoo chart endpoint (no `yfinance`/pandas
dep). Off-domain for product-gap discovery — included for completeness
and for markets/fintech topics. Each symbol → a text-summary post
(latest close, period change %, high/low). Yahoo occasionally rate-limits
unauthenticated calls; on failure we return [] rather than raise.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ._http import DEFAULT_HEADERS
from ._extra_common import text_row

_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"

# Keyword → symbol overrides; otherwise a default basket.
_KEYWORD_SYMBOLS = {
    "nifty": "^NSEI", "sensex": "^BSESN", "bank nifty": "^NSEBANK",
    "rupee": "INR=X", "dollar": "DX-Y.NYB", "gold": "GC=F",
    "oil": "CL=F", "crude": "CL=F", "silver": "SI=F",
    "sp500": "^GSPC", "s&p": "^GSPC", "nasdaq": "^IXIC",
    "bitcoin": "BTC-USD", "btc": "BTC-USD",
}
_DEFAULT = ["^GSPC", "^IXIC", "GC=F", "CL=F"]


def _symbols_for(query: str) -> list[str]:
    q = (query or "").lower()
    hits = [sym for kw, sym in _KEYWORD_SYMBOLS.items() if kw in q]
    return list(dict.fromkeys(hits)) or _DEFAULT


def fetch_yfinance(query: str, limit: int = 6, *, period_range: str = "1mo") -> list[dict]:
    """One row per resolved symbol. Never raises."""
    rows: list[dict] = []
    for sym in _symbols_for(query)[:limit]:
        try:
            r = httpx.get(_CHART.format(sym=sym),
                          params={"range": period_range, "interval": "1d"},
                          headers=DEFAULT_HEADERS, timeout=20.0)
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError):
            continue
        try:
            res = data["chart"]["result"][0]
            closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
            ts_list = res["meta"].get("regularMarketTime") or 0
        except (KeyError, IndexError, TypeError):
            continue
        if not closes:
            continue
        first, last = closes[0], closes[-1]
        chg = ((last - first) / first * 100) if first else 0.0
        hi, lo = max(closes), min(closes)
        rows.append(
            text_row(
                "yfinance",
                ident=f"{sym}:{period_range}",
                title=f"{sym}: {last:.2f} ({chg:+.1f}% over {period_range})",
                body=(f"{sym} latest close {last:.2f}, period change {chg:+.1f}%, "
                      f"high {hi:.2f}, low {lo:.2f}. Source: Yahoo Finance."),
                url=f"https://finance.yahoo.com/quote/{sym}",
                ts=float(ts_list or _now_ts()),
                sub="yfinance",
                author="Yahoo Finance",
            )
        )
    return rows


def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()
