"""Post-quality filter — drops low-quality posts BEFORE they reach the
LLM extractor or graph.

Complements the topic-relevance gate in ``research/relevance.py``:
relevance says "is this post about the topic?", quality_gate says "is
this post actually worth reading?". Zero-upvote AutoModerator rules-reply
threads, one-line "thanks!" replies and bot-generated repost notices
pass relevance but poison finding extraction.

Two levels:

  * **lenient** (always applied) — score ≥ 1, ≥ 40 chars of text, not a
    known platform bot.
  * **strict** (opt-in via ``OPENREPLY_STRICT_QUALITY=1``) — additionally
    requires score ≥ 3 and body ≥ 100 chars. Appropriate for small
    markets / premium topics where precision beats recall.

The bot list is a hand-curated set of the most common Reddit utility
accounts. It's intentionally hardcoded rather than regex-guessed: "bot"
in a username is fine (e.g. ``u/probotics``), but these specific
accounts almost always post boilerplate that mis-leads extractors.
"""
from __future__ import annotations

# Well-known Reddit bot / utility accounts. Matched case-sensitively against
# ``row["author"]``. Kept small on purpose — adding regex-style "ends with
# _bot" matching produced false positives on real users during testing.
_BOT_AUTHORS: frozenset[str] = frozenset({
    "AutoModerator",
    "RemindMeBot",
    "GoodBot_BadBot",
    "stabbot",
    "Mentioned_Videos",
    "havoc_bot",
    "sneakpeekbot",
    "WikiTextBot",
    "SmallSubBot",
    "B0tRank",
    "imguralbumbot",
    "nice-scores",
    "GifReversingBot",
    "RepostSleuthBot",
})


def _text_len(post_row: dict) -> int:
    """Combined title + body character count (counts whitespace — cheap proxy)."""
    title = post_row.get("title") or ""
    body = post_row.get("selftext") or post_row.get("body") or ""
    return len(title) + len(body)


def _score_of(post_row: dict) -> int:
    """Return ``score`` as int; 0 for missing / non-numeric so gate still works."""
    raw = post_row.get("score")
    if raw is None:
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def passes_quality(post_row: dict, strict: bool = False) -> bool:
    """Return True iff the post passes the lenient (and, if ``strict``, the
    strict) quality gate.

    Always-on lenient rules:
      * ``score >= 1`` — zero / negative is usually trolled or junk.
      * ``len(title + selftext) >= 40`` — excludes one-line "thanks!" posts.
      * ``author`` not in ``_BOT_AUTHORS`` — filters platform / utility bots.

    Strict mode additionally requires:
      * ``score >= 3`` — two additional upvotes as a minimum trust signal.
      * body (selftext/body) length ``>= 100`` chars — enough context for
        the extractor to lift a concrete painpoint / feature / quote.
    """
    if _score_of(post_row) < 1:
        return False
    if _text_len(post_row) < 40:
        return False
    if (post_row.get("author") or "") in _BOT_AUTHORS:
        return False

    if strict:
        if _score_of(post_row) < 3:
            return False
        body = post_row.get("selftext") or post_row.get("body") or ""
        if len(body) < 100:
            return False

    return True


__all__ = ["passes_quality"]
