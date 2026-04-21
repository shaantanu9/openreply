"""Unpaywall — free, legal OA PDF finder for any DOI.

~40% of paywalled papers have a legitimate free copy hosted on the
author's university page, an institutional repository, or a preprint
server. Unpaywall indexes all of them and returns the best URL.

Free, no key, polite-pool contact via the `UNPAYWALL_EMAIL` env var (any
email you control — Unpaywall uses it to contact you about rate issues,
nothing else). Without it, requests still work but you're in the slow pool.

API docs: https://unpaywall.org/products/api
"""
from __future__ import annotations

import os
from typing import Any

import httpx

_BASE = "https://api.unpaywall.org/v2"


def _email() -> str:
    return os.environ.get("UNPAYWALL_EMAIL") or "unpaywall@example.invalid"


def lookup_doi(doi: str) -> dict[str, Any] | None:
    """Find the best OA copy of one DOI. Returns:

        {
          "doi": "...",
          "is_oa": bool,
          "oa_status": "gold|green|bronze|hybrid|closed",
          "best_oa_url": "https://.../pdf"  | None,
          "best_oa_host": "publisher|repository",
          "journal_is_oa": bool,
          "n_oa_locations": int,
        }

    or None on miss / network error. Never raises — collect pipelines
    use this in a loop over hundreds of DOIs, one flaky response must
    not tank the batch.
    """
    doi = (doi or "").strip().replace("https://doi.org/", "")
    if not doi:
        return None
    try:
        r = httpx.get(
            f"{_BASE}/{doi}",
            params={"email": _email()},
            headers={"User-Agent": "reddit-myind/0.1"},
            timeout=15.0,
        )
        if r.status_code == 404:
            return {"doi": doi, "is_oa": False, "oa_status": "unknown", "best_oa_url": None}
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return None

    best = data.get("best_oa_location") or {}
    locations = data.get("oa_locations") or []
    return {
        "doi": doi,
        "is_oa": bool(data.get("is_oa")),
        "oa_status": data.get("oa_status") or "unknown",
        "best_oa_url": best.get("url_for_pdf") or best.get("url"),
        "best_oa_host": best.get("host_type"),
        "journal_is_oa": bool(data.get("journal_is_oa")),
        "n_oa_locations": len(locations),
        "title": data.get("title"),
        "year": data.get("year"),
    }


def enrich_post_row(post: dict) -> dict:
    """Given a post row with a DOI somewhere in its URL or permalink, attach
    OA info (`oa_url`, `is_oa`, `oa_status`) as metadata. In-place-safe:
    returns the input with fields added. No-op if DOI not found.
    """
    doi = ""
    for src in (post.get("url"), post.get("permalink"), ""):
        s = (src or "")
        if "doi.org/" in s:
            doi = s.split("doi.org/", 1)[1].strip("/")
            break
        if s.startswith("10."):
            doi = s
            break
    if not doi:
        return post
    info = lookup_doi(doi)
    if not info:
        return post
    post["oa_url"] = info.get("best_oa_url")
    post["oa_status"] = info.get("oa_status")
    post["is_oa"] = bool(info.get("is_oa"))
    return post
