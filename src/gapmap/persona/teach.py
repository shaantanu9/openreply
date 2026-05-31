"""Surgical persona teaching — feed one specific piece of content (e.g. a
YouTube video) to one specific persona and let it learn from just that.

Contrast with :func:`persona.ingest.ingest_persona` which scans the whole
corpus (or a topic) for posts the persona hasn't read. ``teach`` is the
explicit, user-curated path: "child, watch this video, learn from it."

Today only YouTube is wired. The shape generalises — any source that can
materialise posts-table rows can be plugged in (Reddit thread URL, paper
DOI, RSS item, etc.) by adding a sibling fetcher and a URL parser.
"""
from __future__ import annotations

import re
from typing import Iterator

from ..core.db import upsert_posts
from ..research.collect import _tag_posts
from .ingest import ingest_persona
from .store import get_persona

# ── URL parser ──────────────────────────────────────────────────────────
#
# Handles the URL families YouTube actually emits:
#   https://www.youtube.com/watch?v=<id>
#   https://www.youtube.com/watch?v=<id>&t=42s
#   https://m.youtube.com/watch?v=<id>
#   https://youtu.be/<id>
#   https://youtu.be/<id>?t=42
#   https://www.youtube.com/shorts/<id>
#   https://www.youtube.com/live/<id>
#   https://www.youtube.com/embed/<id>
#   <id> on its own (11 chars, [A-Za-z0-9_-])
#
# Returns the canonical 11-char id or None.

_BARE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_URL_PATTERNS = (
    re.compile(r"(?:youtube\.com|youtube-nocookie\.com)/watch\?[^ ]*?v=([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com|youtube-nocookie\.com)/(?:shorts|embed|live|v)/([A-Za-z0-9_-]{11})"),
    re.compile(r"youtu\.be/([A-Za-z0-9_-]{11})"),
)


def parse_youtube_id(url_or_id: str) -> str | None:
    """Extract the 11-char video id from any YouTube URL form, or accept a
    bare id passed verbatim. Returns ``None`` on no match.
    """
    if not url_or_id:
        return None
    s = url_or_id.strip()
    if _BARE_ID_RE.match(s):
        return s
    for pat in _URL_PATTERNS:
        m = pat.search(s)
        if m:
            return m.group(1)
    return None


# Instagram reel / post / tv / stories → shortcode. Instagram has no captions,
# so the teach path transcribes its audio with Whisper (see teach_from_media).
_IG_RE = re.compile(r"instagram\.com/(?:reel|p|tv|stories(?:/[^/]+)?)/([A-Za-z0-9_\-]+)")


def parse_instagram_url(url: str) -> str | None:
    """Extract the IG shortcode from a reel/post/tv/stories URL, else None."""
    if not url:
        return None
    m = _IG_RE.search(url.strip())
    return m.group(1) if m else None


def classify_video_url(url_or_id: str) -> str:
    """Route a shared video URL: 'youtube' | 'instagram' | 'other'.

    YouTube keeps the fast caption path; everything else (Instagram, Vimeo, a
    raw video URL) goes through the Whisper transcript path."""
    if parse_youtube_id(url_or_id):
        return "youtube"
    if parse_instagram_url(url_or_id):
        return "instagram"
    return "other"


# ── Public surface ──────────────────────────────────────────────────────


def teach_from_youtube(
    persona_id: int,
    url_or_id: str,
    *,
    comments_limit: int = 100,
    provider: str | None = None,
) -> Iterator[dict]:
    """Teach one persona from one YouTube video — its description, transcript
    (chunked), and top comments. Streams the same NDJSON event shape as
    :func:`ingest_persona` plus three extra leading events that describe the
    fetch phase, so the UI can render a single unified log.

    Extra events emitted before the standard ingest events:
      {"event": "teach:start",   "video_id": "...", "url": "..."}
      {"event": "teach:fetched", "rows": N, "comments": C, "transcript": T,
                                 "description": D}
      {"event": "teach:error",   "error": "..."}   # only on hard failures
    """
    persona = get_persona(persona_id)
    if not persona:
        yield {"event": "error", "error": f"persona id={persona_id} not found"}
        return

    video_id = parse_youtube_id(url_or_id)
    if not video_id:
        yield {"event": "teach:error", "error": "could not parse a YouTube video id from input"}
        return

    yield {"event": "teach:start", "video_id": video_id, "url": url_or_id}

    # Local imports — heavy modules, only needed when we actually teach.
    try:
        from ..sources.youtube import (
            fetch_youtube_comments,
            fetch_youtube_video_meta,
        )
    except Exception as e:
        yield {"event": "teach:error", "error": f"youtube source unavailable: {e}"}
        return

    try:
        comments = fetch_youtube_comments(video_id, video_title="", limit=comments_limit) or []
        comments = [r for r in comments if "_error" not in r]
    except Exception as e:
        # Comments often fail when a video has them disabled — that's
        # tolerable, transcript is the bigger signal anyway.
        yield {"event": "teach:error", "error": f"comment fetch failed: {e}"}
        comments = []

    try:
        meta = fetch_youtube_video_meta(video_id, video_title="") or []
    except Exception as e:
        yield {"event": "teach:error", "error": f"metadata fetch failed: {e}"}
        meta = []

    rows = comments + meta
    if not rows:
        yield {
            "event": "teach:fetched",
            "rows": 0, "comments": 0, "transcript": 0, "description": 0,
        }
        yield {"event": "done", "kept": 0, "dropped": 0, "errors": 0}
        return

    # Persist to posts. Tag under the persona's lens so the new corpus rows
    # show up for normal lens-scoped queries too, with a "teach:" source
    # prefix that bypasses the relevance gate in research.collect._tag_posts
    # (see research/collect.py: skip_relevance_gate predicate).
    upsert_posts(rows)
    lens = (persona.get("lens") or "").strip() or f"persona_{persona_id}"
    source_tag = f"teach:p{persona_id}:v{video_id}"
    try:
        _tag_posts(lens, [r["id"] for r in rows], source=source_tag)
    except Exception as e:
        # Tag failure is non-fatal — ingest can still proceed on post_ids.
        yield {"event": "teach:error", "error": f"topic tag failed: {e}"}

    n_comments    = sum(1 for r in rows if r.get("source_type") == "youtube")
    n_transcript  = sum(1 for r in rows if r.get("source_type") == "youtube_transcript")
    n_description = sum(1 for r in rows if r.get("source_type") == "youtube_description")
    yield {
        "event": "teach:fetched",
        "rows": len(rows),
        "comments": n_comments,
        "transcript": n_transcript,
        "description": n_description,
    }

    # Hand off to the normal ingest pipeline, scoped to just these rows.
    # `limit` is a safety cap; rows is already bounded (≤100 comments +
    # ≤24 transcript chunks + ≤1 description = ≤125).
    post_ids = [r["id"] for r in rows if r.get("id")]
    yield from ingest_persona(
        persona_id,
        limit=max(200, len(post_ids)),
        provider=provider,
        post_ids=post_ids,
    )


# ── Whisper transcript path (Instagram + any non-YouTube video) ───────────


def _fetch_media_rows(url: str, *, max_chunks: int = 80) -> list[dict]:
    """Whisper-transcribe any video URL (Instagram, Vimeo, raw mp4, …) into
    posts-table rows via the shared yt-dlp→faster-whisper pipeline. Heavy
    import — only loaded when actually teaching."""
    from ..sources.video import fetch_video  # yt-dlp audio → faster-whisper → rows
    rows = fetch_video(url) or []
    return [r for r in rows if r.get("id")][:max_chunks]


def teach_from_media(
    persona_id: int,
    url: str,
    *,
    provider: str | None = None,
) -> Iterator[dict]:
    """Teach one persona from a non-YouTube video (Instagram reel, etc.) by
    transcribing its audio with Whisper, then handing the transcript rows to
    the SAME ingest tail teach_from_youtube uses (memories → embed_and_link →
    the persona's mirofish ChromaDB). Same NDJSON event shape as
    :func:`teach_from_youtube`."""
    persona = get_persona(persona_id)
    if not persona:
        yield {"event": "error", "error": f"persona id={persona_id} not found"}
        return

    yield {"event": "teach:start", "video_id": url, "url": url}

    try:
        rows = _fetch_media_rows(url)
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        hint = (" — Instagram needs a public reel, or login cookies for private/age-gated posts"
                if ("login" in low or "private" in low or "rate" in low or "cookie" in low)
                else "")
        yield {"event": "teach:error", "error": f"transcription failed: {msg[:200]}{hint}"}
        yield {"event": "done", "kept": 0, "dropped": 0, "errors": 1}
        return

    if not rows:
        yield {"event": "teach:fetched", "rows": 0, "comments": 0,
               "transcript": 0, "description": 0}
        yield {"event": "done", "kept": 0, "dropped": 0, "errors": 0}
        return

    # Same persistence + tag + ingest tail as teach_from_youtube.
    upsert_posts(rows)
    lens = (persona.get("lens") or "").strip() or f"persona_{persona_id}"
    try:
        _tag_posts(lens, [r["id"] for r in rows], source=f"teach:p{persona_id}:media")
    except Exception as e:
        yield {"event": "teach:error", "error": f"topic tag failed: {e}"}

    yield {"event": "teach:fetched", "rows": len(rows), "comments": 0,
           "transcript": len(rows), "description": 0}

    yield from ingest_persona(
        persona_id,
        limit=max(200, len(rows)),
        provider=provider,
        post_ids=[r["id"] for r in rows if r.get("id")],
    )


def teach_from_video(
    persona_id: int,
    url: str,
    *,
    comments_limit: int = 100,
    provider: str | None = None,
) -> Iterator[dict]:
    """Route a shared video URL to the right teacher and stream its events.

    YouTube → :func:`teach_from_youtube` (yt-dlp captions + comments +
    description). Instagram / anything else → :func:`teach_from_media`
    (Whisper transcript). Both converge on the same persona-memory pipeline,
    so the caller (CLI / Tauri command / UI) is source-agnostic."""
    if classify_video_url(url) == "youtube":
        yield from teach_from_youtube(
            persona_id, url, comments_limit=comments_limit, provider=provider,
        )
    else:
        yield from teach_from_media(persona_id, url, provider=provider)
