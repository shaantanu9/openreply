"""Map a natural-language question to a source FAMILY.

Pure, dependency-free keyword matching so the chat can scope its answer to just
the sources the user asked about — "what do the research papers say", "what does
the news say", "what do app reviews complain about", etc.

Extracted from the old monolithic chat.py so it can be unit-tested in isolation.
The underscore-prefixed names are kept as aliases for backward compatibility with
the rest of the chat package.
"""
from __future__ import annotations

# (label, source_type values in DB, trigger keywords/phrases)
SOURCE_FAMILIES: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
    ("research papers",
     ("arxiv", "openalex", "pubmed", "crossref", "scholar", "semantic_scholar", "europepmc", "dblp"),
     ("paper", "papers", "research", "researcher", "academic", "academia", "study",
      "studies", "literature", "scholar", "arxiv", "pubmed", "journal", "journals",
      "citation", "citations", "peer-review", "peer reviewed", "scientific", "science says")),
    ("news",
     ("gnews", "rss", "google_news", "news"),
     ("news", "article", "articles", "press", "media", "headline", "headlines",
      "journalist", "reporter", "reporting", "coverage", "blog post", "blogs")),
    ("app store reviews",
     ("playstore", "appstore", "trustpilot", "producthunt", "oc_producthunt_today", "alternativeto"),
     ("app store", "play store", "appstore", "playstore", "app review", "app reviews",
      "store review", "store reviews", "review", "reviews", "rating", "ratings",
      "trustpilot", "app complain", "app complaint", "app complaints", "reviewer", "reviewers")),
    ("developer sources",
     ("hn", "stackoverflow", "github", "github_issue", "devto"),
     ("github", "stack overflow", "stackoverflow", "hacker news", "hackernews",
      "developer", "developers", "issue tracker", "repo", "repos", "repository")),
    ("video",
     ("youtube", "youtube_transcript", "youtube_description"),
     ("youtube", "video", "videos", "creator", "creators", "vlog", "channel")),
    ("community discussion",
     ("reddit", "lemmy", "mastodon", "bluesky", "oc_bluesky", "discourse"),
     ("reddit", "redditor", "redditors", "subreddit", "user", "users", "people",
      "reply", "replies", "community", "forum", "forums", "commenter", "commenters",
      "discussion", "mastodon", "lemmy", "bluesky")),
]


def detect_source_intent(question: str) -> tuple[str, tuple[str, ...]] | None:
    """Return (label, source_types) if the question targets a source family,
    else None. Scored by keyword hits; ties broken by family order above."""
    q = f" {(question or '').lower()} "
    best = None
    best_score = 0
    for label, sources, kws in SOURCE_FAMILIES:
        score = sum(1 for k in kws if k in q)
        if score > best_score:
            best_score = score
            best = (label, sources)
    return best if best_score > 0 else None


# Backward-compatible aliases (old private names used across the chat package).
_SOURCE_FAMILIES = SOURCE_FAMILIES
_detect_source_intent = detect_source_intent
