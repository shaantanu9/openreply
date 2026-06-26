"""Pickable platform catalog for OpenReply.

Each `key` maps to a gapmap source adapter (`sources/collect_adapter.py:SOURCES`)
so opportunity discovery reuses the existing fetch layer. `can_reply` marks
platforms where you actually engage (you'll post a reply there); the rest are
discovery-only — news/web/trends sources that surface conversations and topics to
react to but where you don't reply in-place.

`needs_auth`: "cookie" → connect via Reach Connections; "api_key" → key in
Settings; None → works anonymously.
"""
from __future__ import annotations

PLATFORMS: list[dict] = [
    # --- engage (reply) platforms ---
    {"key": "reddit_free",  "label": "Reddit",          "category": "community", "can_reply": True,  "needs_auth": "cookie"},
    {"key": "x",            "label": "X / Twitter",     "category": "social",    "can_reply": True,  "needs_auth": "cookie"},
    {"key": "linkedin",     "label": "LinkedIn",        "category": "social",    "can_reply": True,  "needs_auth": "cookie"},
    {"key": "threads",      "label": "Threads",         "category": "social",    "can_reply": True,  "needs_auth": "cookie"},
    {"key": "bluesky",      "label": "Bluesky",         "category": "social",    "can_reply": True,  "needs_auth": "api_key"},
    {"key": "mastodon",     "label": "Mastodon",        "category": "social",    "can_reply": True,  "needs_auth": None},
    {"key": "lemmy",        "label": "Lemmy",           "category": "community", "can_reply": True,  "needs_auth": None},
    {"key": "hn",           "label": "Hacker News",     "category": "community", "can_reply": True,  "needs_auth": None},
    {"key": "stackoverflow","label": "Stack Overflow",  "category": "community", "can_reply": True,  "needs_auth": None},
    {"key": "discourse",    "label": "Discourse forums","category": "community", "can_reply": True,  "needs_auth": None},
    {"key": "devto",        "label": "Dev.to",          "category": "community", "can_reply": True,  "needs_auth": None},
    {"key": "producthunt",  "label": "Product Hunt",    "category": "community", "can_reply": True,  "needs_auth": None},
    {"key": "instagram",    "label": "Instagram",       "category": "social",    "can_reply": True,  "needs_auth": "cookie"},
    {"key": "tiktok",       "label": "TikTok",          "category": "social",    "can_reply": True,  "needs_auth": "cookie"},
    {"key": "truthsocial",  "label": "Truth Social",    "category": "social",    "can_reply": True,  "needs_auth": None},
    {"key": "youtube",      "label": "YouTube",         "category": "video",     "can_reply": True,  "needs_auth": None},
    # --- discovery-only (news / web / trends) ---
    {"key": "gnews",        "label": "Google News",     "category": "news",      "can_reply": False, "needs_auth": None},
    {"key": "rss_tech_news","label": "Tech News (RSS)", "category": "news",      "can_reply": False, "needs_auth": None},
    {"key": "rss_user",     "label": "Your custom RSS", "category": "news",      "can_reply": False, "needs_auth": None},
    {"key": "duckduckgo",   "label": "Web search",      "category": "web",       "can_reply": False, "needs_auth": None},
    {"key": "trends",       "label": "Google Trends",   "category": "web",       "can_reply": False, "needs_auth": None},
]

_BY_KEY = {p["key"]: p for p in PLATFORMS}


def get_platform(key: str) -> dict | None:
    return _BY_KEY.get(key)


def reply_platforms() -> list[dict]:
    return [p for p in PLATFORMS if p["can_reply"]]


def all_keys() -> list[str]:
    return [p["key"] for p in PLATFORMS]
