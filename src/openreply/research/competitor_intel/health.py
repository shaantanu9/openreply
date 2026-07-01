"""Per-source health check for competitor sweeps.

Answers the operational question "why did my opportunity fetch only pull from a
few databases?" by probing each source in the pack and classifying the outcome
so the reason is explicit instead of a silent 0.

Design borrowed from the last30days-skill `health.py`: a small typed vocabulary
(ok / empty / needs_credential / blocked / unregistered / error) beats collapsing
every failure into "returned nothing". Each state carries a short repair note.
"""
from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from . import registry

# States, best → worst.
OK = "ok"                          # returned ≥1 row
EMPTY = "empty"                    # ran cleanly but returned 0 (topic may be off-domain)
NEEDS_CREDENTIAL = "needs_credential"  # requires an env var/token that is unset
BLOCKED = "blocked"               # anti-bot / rate-limit (403/429) — degrades to 0
UNREGISTERED = "unregistered"     # id not in the collect adapter SOURCES map
ERROR = "error"                   # raised despite the adapter's own guards

# Sources that need an explicit credential; value = env var(s) that enable them.
_CREDENTIAL_ENV: dict[str, tuple[str, ...]] = {
    "producthunt": ("PH_TOKEN", "PRODUCTHUNT_TOKEN"),
    "tavily": ("TAVILY_API_KEY",),
    "fred": ("FRED_API_KEY",),
    "exa": ("EXA_API_KEY",),
    "acled": ("ACLED_EMAIL", "ACLED_PASSWORD"),
    "tiktok": ("SCRAPECREATORS_API_KEY",),
    "instagram": ("SCRAPECREATORS_API_KEY",),
    "threads": ("SCRAPECREATORS_API_KEY",),
    "pinterest": ("SCRAPECREATORS_API_KEY",),
    "truthsocial": ("TRUTHSOCIAL_TOKEN",),
}

# Sources known to be anti-bot blocked (Cloudflare 403) from most IPs. Kept
# available opt-in but flagged so the reason is honest.
_KNOWN_BLOCKED = {"alternativeto", "trustpilot", "scholar"}


def _credential_note(src: str) -> str | None:
    """Return a note if `src` needs an env var that is currently unset."""
    envs = _CREDENTIAL_ENV.get(src)
    if not envs:
        return None
    if any(os.getenv(e) for e in envs):
        return None
    return f"set {' or '.join(envs)}"


def check_source(src: str, keyword: str, *, timeout: float = 45.0) -> dict[str, Any]:
    """Probe one source with a single keyword. Never raises."""
    from ...sources.collect_adapter import SOURCES

    if src not in SOURCES:
        return {"source": src, "state": UNREGISTERED, "rows": 0,
                "note": "not in collect adapter SOURCES map", "elapsed": 0.0}

    cred = _credential_note(src)
    t0 = time.monotonic()
    try:
        fn = SOURCES[src]
        try:
            rows = fn([keyword])
        except TypeError:
            rows = fn(keyword)
        n = int(rows or 0) if isinstance(rows, int) else len(rows or [])
        elapsed = round(time.monotonic() - t0, 1)
    except Exception as e:  # adapters guard internally, but be safe
        return {"source": src, "state": ERROR, "rows": 0,
                "note": f"{type(e).__name__}: {e}", "elapsed": round(time.monotonic() - t0, 1)}

    if n > 0:
        return {"source": src, "state": OK, "rows": n, "note": "", "elapsed": elapsed}
    # Zero rows — explain why, best guess.
    if cred:
        return {"source": src, "state": NEEDS_CREDENTIAL, "rows": 0, "note": cred, "elapsed": elapsed}
    if src in _KNOWN_BLOCKED:
        return {"source": src, "state": BLOCKED, "rows": 0,
                "note": "anti-bot blocked (403) — needs API key/cookies", "elapsed": elapsed}
    return {"source": src, "state": EMPTY, "rows": 0,
            "note": "0 rows for this keyword (may be off-domain or relevance-gated)",
            "elapsed": elapsed}


def check_sources(
    keyword: str = "Notion",
    sources: list[str] | None = None,
    *,
    max_workers: int = 8,
    timeout: float = 45.0,
) -> dict[str, Any]:
    """Probe every source in `sources` (defaults to DEFAULT_SOURCE_PACK) in
    parallel and return a per-source report plus a rolled-up summary.
    """
    pack = sources or list(registry.DEFAULT_SOURCE_PACK)
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(max_workers, max(1, len(pack)))) as pool:
        futs = {pool.submit(check_source, s, keyword, timeout=timeout): s for s in pack}
        for fut in as_completed(futs):
            r = fut.result()
            results[r["source"]] = r

    ordered = [results[s] for s in pack if s in results]
    working = [r for r in ordered if r["state"] == OK]
    return {
        "keyword": keyword,
        "checked": len(ordered),
        "working": len(working),
        "sources": ordered,
        "summary": {
            state: [r["source"] for r in ordered if r["state"] == state]
            for state in (OK, EMPTY, NEEDS_CREDENTIAL, BLOCKED, UNREGISTERED, ERROR)
        },
    }
