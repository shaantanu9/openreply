"""Source-family normalization for downstream consumers.

The collect adapters emit fine-grained ``source_type`` tags
(``youtube``, ``youtube_description``, ``youtube_transcript``) so the
raw ``posts`` table can distinguish what KIND of YouTube content each
row holds — comments, video description, or transcript chunk.

But downstream code that thinks in "sources" (sentiment per source,
the Sources tab tiles, audience clustering, source-aware UI labels)
needs the COARSE family. Otherwise YouTube content fragments into
three separate buckets, the sentiment LLM gets a transcript chunk
in its "what does YouTube think about X" prompt (transcripts are
the speaker's words, NOT user sentiment), and the user sees three
half-baked YouTube cards instead of one rich one.

This module provides:
  - ``YT_FAMILY`` — the set of raw source_type values that are
    "really YouTube" — comments, description, transcript.
  - ``REDDIT_FAMILY`` — reddit + lemmy (kept here for parity with the
    JS-side ``REDDIT_FAMILY`` in ``app-tauri/src/lib/postLink.js``).
  - ``normalize_source_type(st)`` — Python helper that collapses
    ``youtube_*`` → ``youtube``. Use when iterating posts in memory.
  - ``NORMALIZED_SOURCE_SQL`` — a SQLite ``CASE`` expression that does
    the same collapse inside a SELECT. Use as the GROUP BY key or the
    select alias so aggregations bucket YouTube content together.

Why two surfaces (Python + SQL)? Sometimes the caller does the
aggregation in memory after a query (use the Python helper); sometimes
the caller pushes the GROUP BY to SQLite for cardinality reduction
(use the SQL expression). Keeping them in sync is the whole point of
this module — never inline the CASE again; import this constant.

Battle-tested 2026-05-28 (Gap Map): before this module, the Sentiment
tab showed 3 separate "YouTube" cards (one per subtype) and the
audience cluster step treated each as a separate "source" in its
personas. After, all three roll up correctly.
"""

# Tags emitted by sources/youtube.py — see lines 139, 338, 367 there.
# Any new subtype added in youtube.py MUST also be added here, or the
# subtype's posts will be invisible to sentiment / sources / audience.
YT_FAMILY = frozenset({"youtube", "youtube_description", "youtube_transcript"})

# Kept here for parity with app-tauri/src/lib/postLink.js REDDIT_FAMILY.
# Update both sides together when a new reddit-like source is added.
REDDIT_FAMILY = frozenset({"reddit", "lemmy"})


def normalize_source_type(st: str | None) -> str:
    """Collapse fine-grained subtypes into the coarse family name.

    ``youtube_transcript`` → ``"youtube"``
    ``youtube_description`` → ``"youtube"``
    ``reddit`` → ``"reddit"``
    ``None`` / empty → ``"reddit"`` (legacy default matching the SQL
        ``coalesce(p.source_type, 'reddit')`` fallback used pre-fix)

    Idempotent — already-normalized values pass through unchanged.
    """
    if not st:
        return "reddit"
    s = st.lower()
    if s in YT_FAMILY:
        return "youtube"
    return s


def expand_family(family: str) -> frozenset:
    """Inverse of normalize_source_type: given a coarse family name,
    return every raw source_type value that belongs to it.

    Use this when building a SQL ``WHERE source_type IN (...)`` filter
    that needs to scoop up every YouTube row (comments + transcripts
    + descriptions) given just the family name ``"youtube"``.

    >>> expand_family("youtube")
    frozenset({'youtube', 'youtube_description', 'youtube_transcript'})
    >>> expand_family("hackernews")
    frozenset({'hackernews'})
    """
    f = (family or "").lower()
    if f == "youtube":
        return YT_FAMILY
    if f == "reddit":
        return REDDIT_FAMILY
    return frozenset({f})


# SQLite ``CASE`` expression that mirrors ``normalize_source_type``. Use
# wherever a query needs to GROUP BY or SELECT the normalized family —
# inlining keeps the Python and SQL paths bit-for-bit consistent.
#
# Assumes the source-bearing table is aliased ``p`` (matches the
# convention across research/*.py — JOINs to ``posts AS p``). Wrap the
# expression in parens when composing into larger SQL.
NORMALIZED_SOURCE_SQL = (
    "CASE "
    "WHEN lower(coalesce(p.source_type, '')) LIKE 'youtube%' THEN 'youtube' "
    "WHEN p.source_type IS NULL OR p.source_type = '' THEN 'reddit' "
    "ELSE lower(p.source_type) "
    "END"
)


# Friendly display labels for the SUBTYPES (not the family). The UI's
# main "YouTube" tile groups everything under ``youtube`` via the
# family helpers above, but the Posts / Find tab still wants to tell
# the user "this row is a transcript chunk" vs "this row is a comment"
# so they understand what they're reading.
SUBTYPE_LABELS = {
    "youtube": "comment",
    "youtube_description": "video description",
    "youtube_transcript": "transcript",
}


def subtype_label(st: str | None) -> str | None:
    """Return a human-readable subtype label for display, or None if
    the source_type is not a known subtype. Use to render a small
    chip next to YouTube posts so users can tell comments apart from
    transcripts apart from descriptions.

    Returns None for any source_type without a known subtype (so
    callers can render nothing rather than the raw string).
    """
    if not st:
        return None
    return SUBTYPE_LABELS.get(st.lower())
