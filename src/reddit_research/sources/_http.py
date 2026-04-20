"""Shared HTTP client defaults for all source adapters.

Every source hits an external API that has some combination of:
  - User-Agent policy (arXiv, PubMed, App Store RSS will soft-block
    requests without a polite UA)
  - Polite-pool opt-in (OpenAlex gives `mailto:` requests higher priority)
  - Rate-limit headers we should respect (Retry-After, X-RateLimit-Remaining)

Centralising UA + timeout in one place means the fix is one edit away when
an API tightens its policy, and means every adapter benefits from the
polite defaults by default.
"""
from __future__ import annotations

import os
import time

import httpx


# Identification block. Keep `+URL` for policy reviewers to find the repo,
# `mailto:` so APIs like OpenAlex / arXiv can reach out if we misbehave.
# Contact address comes from the user's profile at session start — override
# with REDDIT_MYIND_CONTACT env if you fork this for a different maintainer.
_DEFAULT_CONTACT = os.getenv("REDDIT_MYIND_CONTACT", "shantanubombatkar2@gmail.com")
USER_AGENT = (
    "reddit-myind/0.1 "
    "(+https://github.com/shaantanu98/reddit-myind; "
    f"mailto:{_DEFAULT_CONTACT})"
)

# 20 s default timeout — long enough for slow science APIs (Scholar +
# OpenAlex sometimes spike to 5–8 s), short enough that a genuinely hung
# server surfaces to the orchestrator instead of blocking the collect.
DEFAULT_TIMEOUT = 20.0

# Standard headers every adapter should attach.
DEFAULT_HEADERS: dict[str, str] = {
    "User-Agent": USER_AGENT,
    "Accept-Encoding": "gzip, deflate",
}


def polite_get(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float | None = None,
) -> httpx.Response:
    """httpx.get with our default UA, timeout, and Retry-After handling.

    On a 429 Too Many Requests, we sleep the Retry-After value (capped at
    15 s so a pathological API can't wedge the whole collect) and retry
    once. On any other HTTP error the caller decides — we surface the
    response and let them `raise_for_status()` if they want.
    """
    merged = {**DEFAULT_HEADERS, **(headers or {})}
    to = timeout if timeout is not None else DEFAULT_TIMEOUT
    r = httpx.get(url, params=params, headers=merged, timeout=to)
    if r.status_code == 429:
        wait_s = _retry_after_seconds(r) or 2.0
        wait_s = min(wait_s, 15.0)
        time.sleep(wait_s)
        r = httpx.get(url, params=params, headers=merged, timeout=to)
    return r


def _retry_after_seconds(resp: httpx.Response) -> float | None:
    """Parse the Retry-After header (seconds form only — HTTP-date is rare)."""
    v = resp.headers.get("retry-after")
    if not v:
        return None
    try:
        return max(0.0, float(v))
    except ValueError:
        return None
