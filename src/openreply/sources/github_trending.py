"""GitHub — trending repos + stars-history-ish signals, keyless where possible.

For search, GitHub's public REST API allows 60 req/h unauth, 5000/h with token.
We rely on anonymous search here, limited to surface-level. See github_issues.py
for authenticated Issues search.

GitHub's official /trending page has no API, so we scrape it with BeautifulSoup
(base dep). This is intentionally polite: one request, short timeout, and we
fall back to [] on any failure.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from ._http import DEFAULT_HEADERS

_API = "https://api.github.com"
_TRENDING = "https://github.com/trending"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _headers() -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _row(r: dict[str, Any]) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((r.get("created_at") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"gh_{r.get('id')}",
        "sub": "github",
        "source_type": "github",
        "author": (r.get("owner") or {}).get("login") or "",
        "title": (r.get("full_name") or "")[:200],
        "selftext": (r.get("description") or "")[:1500],
        "url": r.get("html_url") or "",
        "score": int(r.get("stargazers_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(r.get("open_issues_count") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": r.get("language"),
        "permalink": r.get("html_url"),
        "fetched_at": _now_iso(),
    }


def search_github_repos(query: str, limit: int = 20, sort: str = "stars") -> list[dict]:
    """Search GitHub repos by keyword, sorted by stars (default)."""
    try:
        r = httpx.get(
            f"{_API}/search/repositories",
            params={"q": query, "sort": sort, "per_page": min(100, limit)},
            headers=_headers(),
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    items = (r.json() or {}).get("items") or []
    return [_row(i) for i in items[:limit]]


def _parse_stars_today(text: str) -> int:
    """Parse strings like '1,234 stars today' or '1.2k stars today' to int."""
    if not text:
        return 0
    text = text.lower().replace(",", "").replace("stars today", "").strip()
    m = re.match(r"^([0-9]*\.?[0-9]+)\s*([km]?)$", text)
    if not m:
        try:
            return int(float(text))
        except (ValueError, TypeError):
            return 0
    val, suffix = float(m.group(1)), m.group(2)
    mult = {"k": 1_000, "m": 1_000_000}.get(suffix, 1)
    return int(val * mult)


def fetch_github_trending(
    query: str | None = None,
    since: str = "daily",
    language: str | None = None,
    limit: int = 25,
) -> list[dict]:
    """Scrape github.com/trending for trending repositories.

    `query` is ignored by the trending page itself, but is accepted for API
    compatibility with the other fetchers. Use `language` (e.g. 'python',
    'javascript') to scope to one language; `since` is 'daily' | 'weekly' |
    'monthly'.

    Returns posts-shaped rows so the content pipeline can turn trending repos
    into posts/threads.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    url = _TRENDING
    if language:
        url = f"{_TRENDING}/{language}"
    params = {"since": since}
    try:
        r = httpx.get(
            url,
            params=params,
            headers={**DEFAULT_HEADERS, "Accept": "text/html"},
            timeout=20,
            follow_redirects=True,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    rows: list[dict] = []
    for article in soup.find_all("article", class_="Box-row")[:limit]:
        h2 = article.find("h2")
        a = h2.find("a") if h2 else None
        if not a:
            continue
        full_name = " ".join(a.get_text(strip=True).split()).replace(" ", "")
        if not full_name or "/" not in full_name:
            continue
        owner, name = full_name.split("/", 1)
        desc_tag = article.find("p")
        description = desc_tag.get_text(strip=True) if desc_tag else ""
        lang_tag = article.find(attrs={"itemprop": "programmingLanguage"})
        language_name = lang_tag.get_text(strip=True) if lang_tag else None

        # GitHub shows total stars in the stargazers link and "X stars today"
        # elsewhere in the row. Prefer the explicit "today" count.
        stars_today = 0
        for text_node in article.stripped_strings:
            if "stars today" in text_node.lower() or "star today" in text_node.lower():
                stars_today = _parse_stars_today(text_node)
                if stars_today:
                    break
        if not stars_today:
            for link in article.find_all("a", href=True):
                if "/stargazers" in link.get("href", ""):
                    stars_today = _parse_stars_today(link.get_text(strip=True))
                    break

        repo_url = f"https://github.com/{full_name}"
        rows.append({
            "id": f"gh_trending_{full_name.replace('/', '_')}",
            "sub": "github:trending",
            "source_type": "github_trending",
            "author": owner,
            "title": full_name[:200],
            "selftext": description[:1500],
            "url": repo_url,
            "score": stars_today,
            "upvote_ratio": None,
            "num_comments": 0,
            "created_utc": 0.0,
            "is_self": 1,
            "over_18": 0,
            "flair": language_name,
            "permalink": repo_url,
            "fetched_at": _now_iso(),
        })
    return rows
