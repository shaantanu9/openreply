"""Whisper + yt-dlp transcription layer.

Public API:
  transcribe_audio(path, model_tier, language, progress_cb) → (segments, info)
  chunk_segments(segments, max_chars)                       → list[chunk-dict]
  download_model(tier, progress_cb)                         → Path
  list_installed(), delete_model(tier), default_tier(), set_default_tier(tier)
  ensure_latest_ytdlp()                                     → status dict
"""
from __future__ import annotations

from .chunker import chunk_segments, segments_to_srt
from .models import (
    MODELS,
    DEFAULT_TIER,
    catalogue,
    default_tier,
    delete_model,
    discover_installed_external,
    download_model,
    list_installed,
    models_root,
    resolve_model_path,
    set_default_tier,
)
from .whisper import Segment, transcribe_audio
from .ytdlp_client import ensure_latest_ytdlp, ensure_latest_ytdlp_background, ytdlp_current_version

__all__ = [
    "Segment",
    "chunk_segments",
    "segments_to_srt",
    "transcribe_audio",
    "MODELS",
    "DEFAULT_TIER",
    "catalogue",
    "default_tier",
    "delete_model",
    "discover_installed_external",
    "download_model",
    "list_installed",
    "models_root",
    "resolve_model_path",
    "set_default_tier",
    "ensure_latest_ytdlp",
    "ensure_latest_ytdlp_background",
    "ytdlp_current_version",
]
