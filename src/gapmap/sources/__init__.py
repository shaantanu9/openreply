"""Multi-source fetchers. Each adapter pulls from a specific platform and
returns rows in our common `posts` shape so dedup + graph + research
extraction all work unchanged.

Zero-config free sources (no API key):
  reddit / hn / appstore / playstore / scholar / stackoverflow / trends
  arxiv / openalex / pubmed / gnews / devto
  lemmy / mastodon / github_trending / npm / pypi / wikipedia / discourse

Config-gated (free API key/token required):
  github_issues — GITHUB_TOKEN (optional, higher quota)
  youtube       — YOUTUBE_API_KEY (Google Cloud free tier)
  producthunt   — PH_TOKEN (developer account)

Known unsupported (anti-bot):
  bluesky       — requires app-password auth as of 2026
  alternativeto — Cloudflare-gated, scraping blocked
"""
from .hackernews import fetch_hn
from .appstore import fetch_appstore_reviews, search_appstore_apps
from .playstore import fetch_playstore_reviews, search_playstore_apps
from .scholar import fetch_scholar
from .stackoverflow import fetch_stackoverflow
from .trends import fetch_trends
from .arxiv import fetch_arxiv
from .openalex import fetch_openalex
from .pubmed import fetch_pubmed
from .gnews import fetch_gnews
from .devto import fetch_devto
from .lemmy import fetch_lemmy
from .bluesky import fetch_bluesky
from .mastodon import fetch_mastodon
from .alternativeto import fetch_alternativeto
from .github_trending import search_github_repos
from .github_issues import fetch_github_issues
from .npmstats import fetch_npm_downloads, search_npm_packages
from .pypistats import fetch_pypi_downloads, search_pypi_packages
from .wikipedia import fetch_wikipedia_pageviews, fetch_wikipedia_summary
from .discourse import fetch_discourse
from .youtube import fetch_youtube_comments, search_youtube_videos
from .producthunt import fetch_producthunt

__all__ = [
    "fetch_hn", "fetch_appstore_reviews", "search_appstore_apps",
    "fetch_playstore_reviews", "search_playstore_apps",
    "fetch_scholar", "fetch_stackoverflow", "fetch_trends",
    "fetch_arxiv", "fetch_openalex", "fetch_pubmed", "fetch_gnews", "fetch_devto",
    "fetch_lemmy", "fetch_bluesky", "fetch_mastodon", "fetch_alternativeto",
    "search_github_repos", "fetch_github_issues",
    "fetch_npm_downloads", "search_npm_packages",
    "fetch_pypi_downloads", "search_pypi_packages",
    "fetch_wikipedia_pageviews", "fetch_wikipedia_summary",
    "fetch_discourse", "fetch_youtube_comments", "search_youtube_videos",
    "fetch_producthunt",
]
