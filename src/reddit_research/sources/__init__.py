"""Multi-source fetchers. Each adapter pulls from a specific platform and
returns rows in our common `posts` shape so dedup + graph + research
extraction all work unchanged.

Source types:
  reddit         — existing (fetch/ modules)
  hn             — Hacker News (Algolia API, free/no-key)
  appstore       — iOS App Store reviews (iTunes RSS, free/no-key)
  playstore      — Google Play reviews (google-play-scraper pkg)
  scholar        — Semantic Scholar (free/no-key)
  stackoverflow  — StackExchange API (free, optional key for higher quota)
  trends         — Google Trends (pytrends) — stored in trend_series, NOT posts
"""
from .hackernews import fetch_hn
from .appstore import fetch_appstore_reviews, search_appstore_apps
from .playstore import fetch_playstore_reviews, search_playstore_apps
from .scholar import fetch_scholar
from .stackoverflow import fetch_stackoverflow
from .trends import fetch_trends

__all__ = [
    "fetch_hn",
    "fetch_appstore_reviews", "search_appstore_apps",
    "fetch_playstore_reviews", "search_playstore_apps",
    "fetch_scholar",
    "fetch_stackoverflow",
    "fetch_trends",
]
