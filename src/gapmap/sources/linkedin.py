"""LinkedIn — public-URL reader via Jina. Partial by platform nature.

LinkedIn is aggressively anti-scrape. The reliable, no-login path is to read a
public LinkedIn URL (profile / company / post) through Jina Reader and return it
as one post row. Deep profile/company/job *search* needs the upstream
linkedin-scraper MCP and a `li_at` session — out of scope here; the Reach
Connections flow stores the `li_at` cookie for when that lands. Never raises.
"""
from __future__ import annotations

from . import web_reader


def fetch_linkedin(query: str, limit: int = 1, **_) -> list[dict]:
    """Read a public LinkedIn URL in *query* via Jina → one post row.
    Non-LinkedIn URL or empty → []. Never raises."""
    url = (query or "").strip()
    if not url or "linkedin.com" not in url:
        return []
    text = web_reader._jina_read(url)
    if text is None:
        return []
    return [web_reader._row(url, text, "linkedin")]
