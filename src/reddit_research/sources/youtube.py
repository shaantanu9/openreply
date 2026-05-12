"""YouTube videos + comments via yt-dlp (free, no API key, no quota).

Falls back to YouTube Data API v3 (``YOUTUBE_API_KEY`` env) only if yt-dlp is
unavailable. yt-dlp scrapes the public web frontend so there is no daily quota
— ideal for corpus building.

Output row shape is identical to the legacy API-key implementation so the
adapter in ``collect_adapter.py`` works unchanged.
"""
from __future__ import annotations

import os
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
