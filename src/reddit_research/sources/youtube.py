"""YouTube videos + comments via yt-dlp (free, no API key, no quota).

Falls back to YouTube Data API v3 (``YOUTUBE_API_KEY`` env) only if yt-dlp is
unavailable. yt-dlp scrapes the public web frontend so there is no daily quota
— ideal for corpus building.

Output row shape is identical to the legacy API-key implementation so the
adapter in ``collect_adapter.py`` works unchanged.
"""
from __future__ import annotations

import html
import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx

_API_BASE = "https://www.googleapis.com/youtube/v3"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ytdlp_ready() -> bool:
    """Inject the overlay (pinned latest yt-dlp) and try importing yt_dlp."""
    try:
        from ..transcribe.ytdlp_client import _inject_overlay_to_path
        _inject_overlay_to_path()
    except Exception:
        pass
    try:
        import yt_dlp  # noqa: F401
        return True
    except Exception:
        return False


def _ytdlp_opts(extra: dict | None = None) -> dict:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": False,
        "ignoreerrors": True,
        "noplaylist": False,
    }
    if extra:
        opts.update(extra)
    return opts


# ── yt-dlp backend (preferred) ──────────────────────────────────────────────

def _search_via_ytdlp(query: str, limit: int) -> list[dict] | None:
    try:
        import yt_dlp
    except Exception:
        return None
    n = max(1, min(50, int(limit)))
    url = f"ytsearch{n}:{query}"
    opts = _ytdlp_opts({"extract_flat": "in_playlist"})
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}
    except Exception:
        return None
    entries = info.get("entries") or []
    out: list[dict] = []
    for e in entries:
        if not e:
            continue
        vid = e.get("id") or e.get("video_id")
        if not vid:
            continue
        out.append({
            "video_id": vid,
            "title": e.get("title"),
            "channel": e.get("uploader") or e.get("channel"),
            "published": e.get("upload_date") or None,  # YYYYMMDD; informational only
        })
    return out


def _comments_via_ytdlp(video_id: str, video_title: str, limit: int) -> list[dict] | None:
    try:
        import yt_dlp
    except Exception:
        return None
    n = max(1, int(limit))
    # `getcomments=True` triggers the comment extractor. `max_comments` is a
    # list-of-four: [TopLevel, ReplyPerThread, RepliesTotal, GlobalMax]. We
    # only need a global cap so set the first and last; reply counts default.
    opts = _ytdlp_opts({
        "getcomments": True,
        "extractor_args": {
            "youtube": {
                "comment_sort": ["top"],
                "max_comments": [str(n), "all", "all", str(n)],
            },
        },
    })
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}
    except Exception:
        return None
    title = video_title or info.get("title") or ""
    comments = info.get("comments") or []
    rows: list[dict] = []
    for c in comments:
        cid = c.get("id")
        if not cid:
            continue
        try:
            ts = float(c.get("timestamp") or 0.0)
        except (TypeError, ValueError):
            ts = 0.0
        rows.append({
            "id": f"yt_{cid}",
            "sub": f"youtube:{video_id}",
            "source_type": "youtube",
            "author": c.get("author") or "[anon]",
            "title": (title or "")[:200],
            "selftext": (c.get("text") or "")[:2000],
            "url": f"https://youtu.be/{video_id}",
            "score": int(c.get("like_count") or 0),
            "upvote_ratio": None,
            "num_comments": 0,
            "created_utc": ts,
            "is_self": 1,
            "over_18": 0,
            "flair": None,
            "permalink": f"https://youtu.be/{video_id}",
            "fetched_at": _now_iso(),
        })
    return rows


# ── transcript / description (yt-dlp only) ─────────────────────────────────
#
# The persona-agents ingest in src/reddit_research/persona/ingest.py reads
# `posts.title` + `posts.selftext` from rows joined to a topic. To let a
# persona learn from the *content* of a video (not just its comments) we
# fetch the auto-captions + description from yt-dlp and emit additional
# posts rows. Each transcript is split into ~1400-char chunks so it lines
# up with the ingest body trim (1500 chars at ingest.py:194) and so a single
# 30-min video doesn't dominate ChromaDB recall.

_TC_LINE_RE       = re.compile(r"^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\s*-->")
_INLINE_TAG_RE    = re.compile(r"<[^>]+>")                  # <c.colorE5E5E5>, <00:00:01.000>, etc.
_TRANSCRIPT_MAX_CHUNKS = 24  # hard cap per video — protects against pathological long-form
_TRANSCRIPT_CHUNK_CHARS = 1400  # < ingest.py body trim (1500) so chunks survive intact
_TRANSCRIPT_LANG_PRIORITY = ("en", "en-US", "en-GB", "en-orig", "en-auto")


def _vtt_to_text(vtt: str) -> str:
    """Strip WebVTT headers, timecodes, cue settings, and inline tags.

    YouTube's auto-captions are emitted as a karaoke-style stream where each
    word has its own `<00:00:01.500>` inline timestamp; left in place that
    triples the byte count and clutters the LLM prompt. We also drop the
    file-level header block (everything before the first cue: ``WEBVTT``,
    ``Kind: captions``, ``Language: en``, optional STYLE/REGION blocks) and
    de-duplicate consecutive identical lines (yt-auto-captions repeat the
    last line of each cue at the top of the next cue for accessibility).
    """
    if not vtt:
        return ""
    lines: list[str] = []
    in_note = False
    seen_first_cue = False
    for raw in vtt.splitlines():
        s = raw.strip()
        if not s:
            in_note = False
            continue
        if "-->" in s and _TC_LINE_RE.search(s):
            seen_first_cue = True
            continue
        if not seen_first_cue:
            # File header (WEBVTT, Kind:, Language:, STYLE/REGION/NOTE blocks)
            # — drop everything before the first cue timing line.
            continue
        if s.upper().startswith("NOTE"):
            in_note = True
            continue
        if in_note:
            continue
        cleaned = _INLINE_TAG_RE.sub("", s)
        cleaned = html.unescape(cleaned).strip()
        if not cleaned:
            continue
        if lines and lines[-1] == cleaned:
            continue
        lines.append(cleaned)
    text = " ".join(lines)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _chunk_transcript(text: str, chunk_chars: int = _TRANSCRIPT_CHUNK_CHARS) -> list[str]:
    """Split a long transcript into ~chunk_chars segments on sentence boundaries.

    No overlap — we want each chunk to map to one persona memory without
    duplicate-evidence noise polluting the union-find clustering in
    persona/conclude.py.
    """
    if not text:
        return []
    if len(text) <= chunk_chars:
        return [text]
    # Sentence-ish split. Keep the punctuation; tolerate "Mr." etc. by not
    # over-engineering — the trailing fragments get joined to the next chunk.
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for sent in sentences:
        if not sent:
            continue
        sl = len(sent) + 1
        if buf_len + sl > chunk_chars and buf:
            chunks.append(" ".join(buf).strip())
            buf, buf_len = [], 0
        # If a single "sentence" is itself longer than the cap (rare — long
        # caption line with no punctuation), hard-slice it.
        while sl > chunk_chars:
            chunks.append(sent[:chunk_chars])
            sent = sent[chunk_chars:]
            sl = len(sent) + 1
        buf.append(sent)
        buf_len += sl
    if buf:
        chunks.append(" ".join(buf).strip())
    return chunks[:_TRANSCRIPT_MAX_CHUNKS]


def _pick_caption_url(captions: dict, languages: tuple[str, ...]) -> str | None:
    """Return the first vtt URL matching the language priority list.

    yt-dlp shapes both `subtitles` and `automatic_captions` as
    ``{lang: [{ext, url, name, ...}, ...]}``. Prefer the ``vtt`` ext; fall
    back to ``srv3``/``srv2``/``srv1`` (XML-ish) only if no vtt exists.
    """
    if not isinstance(captions, dict):
        return None
    # Build (lang, formats) ordered by priority + everything-else.
    ordered_keys = [k for k in languages if k in captions]
    for k in captions:
        if k not in ordered_keys:
            ordered_keys.append(k)
    for lang in ordered_keys:
        fmts = captions.get(lang) or []
        for ext_pref in ("vtt", "srv3", "srv2", "srv1", "ttml"):
            for f in fmts:
                if (f.get("ext") or "").lower() == ext_pref and f.get("url"):
                    return f["url"]
    return None


def _fetch_caption_text(url: str) -> str:
    try:
        r = httpx.get(url, timeout=20)
        r.raise_for_status()
    except httpx.HTTPError:
        return ""
    body = r.text or ""
    # srv* / ttml formats are XML; do a coarse tag strip rather than building
    # a full parser. Good enough to feed an LLM filter.
    if "<transcript" in body or "<tt " in body or "<text " in body:
        body = re.sub(r"<[^>]+>", " ", body)
        body = html.unescape(body)
        return re.sub(r"\s+", " ", body).strip()
    return _vtt_to_text(body)


def _video_meta_via_ytdlp(video_id: str, video_title: str) -> list[dict] | None:
    """Fetch video description + transcript (manual subs > auto-captions) as
    posts-shaped rows. Returns ``None`` if yt-dlp is unavailable; returns
    ``[]`` if the video has neither a description nor any caption track.

    The row shape mirrors :func:`_comments_via_ytdlp` so :func:`_persist`
    needs no changes. Each row gets a distinct ``source_type`` so downstream
    consumers (insights, persona-graph) can tell them apart from comments.
    """
    try:
        import yt_dlp
    except Exception:
        return None
    opts = _ytdlp_opts({
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": list(_TRANSCRIPT_LANG_PRIORITY),
        "subtitlesformat": "vtt",
        # Don't actually write files to disk; we only need the populated
        # `subtitles` / `automatic_captions` dicts on the info object.
        "allsubtitles": False,
    })
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}
    except Exception:
        return None

    title = (video_title or info.get("title") or "")[:200]
    description = (info.get("description") or "").strip()
    uploader = info.get("uploader") or info.get("channel") or "[channel]"
    try:
        upload_ts = float(info.get("epoch") or 0.0)
    except (TypeError, ValueError):
        upload_ts = 0.0

    rows: list[dict] = []

    if description:
        rows.append({
            "id": f"yt_{video_id}_desc",
            "sub": f"youtube:{video_id}",
            "source_type": "youtube_description",
            "author": uploader,
            "title": title,
            "selftext": description[:4000],
            "url": f"https://youtu.be/{video_id}",
            "score": int(info.get("view_count") or 0),
            "upvote_ratio": None,
            "num_comments": int(info.get("comment_count") or 0),
            "created_utc": upload_ts,
            "is_self": 1,
            "over_18": 0,
            "flair": None,
            "permalink": f"https://youtu.be/{video_id}",
            "fetched_at": _now_iso(),
        })

    # Prefer human-uploaded subs; fall back to auto-captions.
    cap_url = (
        _pick_caption_url(info.get("subtitles") or {}, _TRANSCRIPT_LANG_PRIORITY)
        or _pick_caption_url(info.get("automatic_captions") or {}, _TRANSCRIPT_LANG_PRIORITY)
    )
    if cap_url:
        transcript = _fetch_caption_text(cap_url)
        if transcript:
            chunks = _chunk_transcript(transcript)
            for i, chunk in enumerate(chunks):
                rows.append({
                    "id": f"yt_{video_id}_tx{i:02d}",
                    "sub": f"youtube:{video_id}",
                    "source_type": "youtube_transcript",
                    "author": uploader,
                    "title": f"{title} · transcript {i + 1}/{len(chunks)}"[:200],
                    "selftext": chunk[:2000],
                    "url": f"https://youtu.be/{video_id}",
                    "score": int(info.get("view_count") or 0),
                    "upvote_ratio": None,
                    "num_comments": 0,
                    "created_utc": upload_ts,
                    "is_self": 1,
                    "over_18": 0,
                    "flair": None,
                    "permalink": f"https://youtu.be/{video_id}",
                    "fetched_at": _now_iso(),
                })
    return rows


# ── YouTube Data API v3 backend (legacy fallback) ───────────────────────────

def _api_key() -> str | None:
    return os.getenv("YOUTUBE_API_KEY") or None


def _search_via_api(query: str, limit: int) -> list[dict]:
    key = _api_key()
    if not key:
        return [{"_error": "yt-dlp unavailable and YOUTUBE_API_KEY not set"}]
    try:
        r = httpx.get(
            f"{_API_BASE}/search",
            params={
                "key": key, "q": query, "part": "snippet", "type": "video",
                "maxResults": min(50, limit), "order": "relevance",
            },
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    items = (r.json() or {}).get("items") or []
    return [
        {
            "video_id": i.get("id", {}).get("videoId"),
            "title": (i.get("snippet") or {}).get("title"),
            "channel": (i.get("snippet") or {}).get("channelTitle"),
            "published": (i.get("snippet") or {}).get("publishedAt"),
        }
        for i in items
    ]


def _api_comment_row(c: dict[str, Any], video_id: str, video_title: str) -> dict[str, Any]:
    top = (c.get("snippet") or {}).get("topLevelComment", {}).get("snippet") or {}
    try:
        ts = datetime.fromisoformat((top.get("publishedAt") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"yt_{c.get('id')}",
        "sub": f"youtube:{video_id}",
        "source_type": "youtube",
        "author": top.get("authorDisplayName") or "[anon]",
        "title": video_title[:200],
        "selftext": (top.get("textOriginal") or "")[:2000],
        "url": f"https://youtu.be/{video_id}",
        "score": int(top.get("likeCount") or 0),
        "upvote_ratio": None,
        "num_comments": int(c.get("snippet", {}).get("totalReplyCount") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": f"https://youtu.be/{video_id}",
        "fetched_at": _now_iso(),
    }


def _comments_via_api(video_id: str, video_title: str, limit: int) -> list[dict]:
    key = _api_key()
    if not key:
        return [{"_error": "yt-dlp unavailable and YOUTUBE_API_KEY not set"}]
    collected: list[dict] = []
    token: str | None = None
    while len(collected) < limit:
        params: dict[str, Any] = {
            "key": key, "videoId": video_id, "part": "snippet",
            "maxResults": min(100, limit - len(collected)), "order": "relevance",
        }
        if token:
            params["pageToken"] = token
        try:
            r = httpx.get(f"{_API_BASE}/commentThreads", params=params, timeout=20)
            r.raise_for_status()
        except httpx.HTTPError:
            break
        data = r.json() or {}
        items = data.get("items") or []
        if not items:
            break
        collected.extend(_api_comment_row(c, video_id, video_title) for c in items)
        token = data.get("nextPageToken")
        if not token:
            break
    return collected


# ── public surface (collect_adapter.py imports these) ───────────────────────

def search_youtube_videos(query: str, limit: int = 10) -> list[dict]:
    """Search YouTube. yt-dlp first (no key), API fallback if yt-dlp missing."""
    if _ytdlp_ready():
        rows = _search_via_ytdlp(query, limit)
        if rows is not None:
            return rows
    return _search_via_api(query, limit)


def fetch_youtube_comments(video_id: str, video_title: str = "", limit: int = 100) -> list[dict]:
    """Fetch top-voted comments for a video. yt-dlp first, API fallback."""
    if _ytdlp_ready():
        rows = _comments_via_ytdlp(video_id, video_title, limit)
        if rows is not None:
            return rows
    return _comments_via_api(video_id, video_title, limit)


def fetch_youtube_video_meta(video_id: str, video_title: str = "") -> list[dict]:
    """Fetch description + transcript chunks for a video as posts rows.

    yt-dlp only — the YouTube Data API v3 caption endpoint requires OAuth +
    per-video billing, so transcripts only flow when yt-dlp is available.
    Returns an empty list if yt-dlp is missing or the video has neither a
    description nor any caption track. Callers should treat absence as a
    soft miss (still ingest the comments) rather than an error.
    """
    if not _ytdlp_ready():
        return []
    rows = _video_meta_via_ytdlp(video_id, video_title)
    return rows or []
