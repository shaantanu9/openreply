"""Video source — yt-dlp → faster-whisper → posts-table rows.

Uses the shared transcribe/ package. Row shape matches every other adapter
(reddit, hn, appstore, arxiv…) so downstream corpus / graph / report code
needs zero changes.

Per-row layout::

    id           = 'video:<video_id>:<chunk_idx>'
    source_type  = 'video'
    sub          = <normalized channel name>
    title        = <video title>
    selftext     = <chunk text>
    url          = '<canonical_url>#t=<start_ts_seconds>'
    created_utc  = <upload_date epoch>
    metadata_json = { duration_s, language, timestamp_start, timestamp_end,
                      model_used, chunk_idx, chunk_total, video_id }
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from ..transcribe import (
    chunk_segments,
    default_tier,
    ensure_latest_ytdlp,
    segments_to_srt,
    transcribe_audio,
)
from ..transcribe.ytdlp_client import _inject_overlay_to_path


# ── paths ───────────────────────────────────────────────────────────────────

def _data_root() -> Path:
    env = os.environ.get("GAPMAP_DATA_DIR")
    if env:
        return Path(env)
    return Path.home() / ".config" / "gapmap"


def _transcripts_dir() -> Path:
    p = _data_root() / "transcripts"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _audio_cache_dir() -> Path:
    p = _data_root() / "audio-cache"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _video_id(url: str, yt_info: dict) -> str:
    vid = yt_info.get("id")
    if vid:
        return str(vid)
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]


def _parse_upload_date(s: str | None) -> float:
    """yt-dlp returns ``upload_date`` as 'YYYYMMDD' (or None)."""
    if not s or len(s) != 8 or not s.isdigit():
        return datetime.now(timezone.utc).timestamp()
    try:
        return datetime(int(s[0:4]), int(s[4:6]), int(s[6:8]),
                        tzinfo=timezone.utc).timestamp()
    except ValueError:
        return datetime.now(timezone.utc).timestamp()


def _ffmpeg_location() -> str | None:
    """Bundled ffmpeg path, set by Rust at sidecar spawn time.

    Resolution order:
      1. ``GAPMAP_FFMPEG_PATH`` env (set by Rust from bundle resources).
      2. System PATH — relied on only in dev mode.
    """
    return os.environ.get("GAPMAP_FFMPEG_PATH") or None


# ── public API ──────────────────────────────────────────────────────────────

def preview_video(url: str) -> dict:
    """Pull metadata without downloading audio. Used by the Ingest preview."""
    _inject_overlay_to_path()
    try:
        import yt_dlp
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "Install the video extra: pip install -e '.[video]'"
        ) from e

    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "extract_flat": False}
    ffmpeg = _ffmpeg_location()
    if ffmpeg:
        opts["ffmpeg_location"] = ffmpeg
    with yt_dlp.YoutubeDL(opts) as y:
        info = y.extract_info(url, download=False)

    # Reduce playlist entries to the first item for preview purposes.
    if isinstance(info, dict) and info.get("_type") == "playlist":
        entries = info.get("entries") or []
        info = entries[0] if entries else info

    vid = _video_id(url, info or {})
    return {
        "title":         info.get("title"),
        "duration_s":    info.get("duration"),
        "channel":       info.get("channel") or info.get("uploader"),
        "uploaded":      info.get("upload_date"),
        "thumbnail":     info.get("thumbnail"),
        "video_id":      vid,
        "canonical_url": info.get("webpage_url") or url,
        "cached":        (_transcripts_dir() / f"{vid}.json").exists(),
    }


def fetch_video(
    url: str,
    topic: str | None = None,
    model: str = "auto",
    language: str | None = None,
    progress_cb: Callable[[dict], None] | None = None,
) -> list[dict]:
    """Pull audio for ``url`` (or use cached transcript), transcribe with the
    given ``model`` tier (``'auto'`` resolves to :func:`default_tier`), chunk
    the transcript, and return posts-table rows.

    Never writes to DB — caller persists via ``upsert_posts``. Side-effects
    on disk: writes ``transcripts/<id>.json`` + ``.srt`` caches.
    """
    # Fire the overlay check (blocking on first call; cached via 24h stamp)
    # so we can rely on an up-to-date yt-dlp for this specific URL.
    ensure_latest_ytdlp()

    tier = default_tier() if model == "auto" else model
    meta = preview_video(url)
    vid = meta["video_id"]
    canonical = meta["canonical_url"]

    cache_path = _transcripts_dir() / f"{vid}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        segments = cached["segments"]
        info = cached["info"]
        if progress_cb:
            progress_cb({"stage": "cache_hit", "video_id": vid})
    else:
        if progress_cb:
            progress_cb({"stage": "download", "pct": 0, "video_id": vid})
        audio_path = _audio_cache_dir() / f"{vid}.m4a"
        if not audio_path.exists():
            import yt_dlp
            ydl_opts: dict = {
                "format": "bestaudio[ext=m4a]/bestaudio",
                "outtmpl": str(audio_path),
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
            }
            ffmpeg = _ffmpeg_location()
            if ffmpeg:
                ydl_opts["ffmpeg_location"] = ffmpeg
            with yt_dlp.YoutubeDL(ydl_opts) as y:
                y.download([url])
        if progress_cb:
            progress_cb({"stage": "download", "pct": 100, "video_id": vid})

        segs, info = transcribe_audio(
            audio_path,
            model_tier=tier,
            language=None if (language in (None, "", "auto")) else language,
            progress_cb=progress_cb,
        )
        segments = [{"start": s.start, "end": s.end, "text": s.text} for s in segs]
        cache_path.write_text(json.dumps(
            {"segments": segments, "info": info, "meta": meta},
            indent=2, ensure_ascii=False,
        ))
        (_transcripts_dir() / f"{vid}.srt").write_text(segments_to_srt(segs))
        if not os.environ.get("KEEP_VIDEO_AUDIO"):
            try:
                audio_path.unlink()
            except FileNotFoundError:
                pass

    # Chunk + row-shape
    chunks = chunk_segments(segments, max_chars=500)
    if not chunks:
        return []

    created_utc = _parse_upload_date(meta.get("uploaded"))
    channel = (meta.get("channel") or "unknown").lower()
    channel = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in channel).strip("-") or "unknown"

    rows: list[dict] = []
    total = len(chunks)
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for c in chunks:
        start_ts = int(c["timestamp_start"])
        rows.append({
            "id":           f"video:{vid}:{c['chunk_idx']}",
            "sub":          channel,
            "source_type":  "video",
            "author":       meta.get("channel") or "",
            "title":        meta.get("title") or url,
            "selftext":     c["text"],
            "url":          f"{canonical}#t={start_ts}",
            "score":        0,
            "upvote_ratio": None,
            "num_comments": 0,
            "created_utc":  created_utc,
            "is_self":      True,
            "over_18":      False,
            "flair":        None,
            "permalink":    canonical,
            "fetched_at":   fetched_at,
            "metadata_json": json.dumps({
                "duration_s":      meta.get("duration_s"),
                "language":        info.get("language"),
                "timestamp_start": c["timestamp_start"],
                "timestamp_end":   c["timestamp_end"],
                "model_used":      info.get("model_used") or tier,
                "chunk_idx":       c["chunk_idx"],
                "chunk_total":     total,
                "video_id":        vid,
            }, ensure_ascii=False),
        })
    if progress_cb:
        progress_cb({"stage": "done", "chunks": total, "video_id": vid,
                     "model_used": info.get("model_used") or tier,
                     "language": info.get("language")})
    return rows


def fetch_and_persist(
    url: str,
    topic: str | None = None,
    model: str = "auto",
    language: str | None = None,
    progress_cb: Callable[[dict], None] | None = None,
) -> dict:
    """Transcribe + upsert into posts (+ tag under topic). Returns a summary."""
    from ..core.db import log_fetch_end, log_fetch_start, upsert_posts
    from ..research.collect import _tag_posts

    fid = log_fetch_start("source:video", {"url": url, "topic": topic,
                                           "model": model, "language": language})
    try:
        rows = fetch_video(url, topic=topic, model=model, language=language,
                           progress_cb=progress_cb)
        if rows:
            upsert_posts(rows)
            if topic:
                _tag_posts(topic, [r["id"] for r in rows],
                           source=f"video:{rows[0]['metadata_json']}")
        log_fetch_end(fid, rows=len(rows))
        return {"ok": True, "rows": len(rows), "url": url, "topic": topic}
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return {"ok": False, "error": str(e), "url": url, "topic": topic}
