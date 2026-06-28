"""Thin wrapper over faster-whisper.

Why faster-whisper + int8: 4× faster than vanilla openai-whisper on CPU with
no measurable quality drop for English. CT2 (``compute_type='int8'``) fits
large models on 8 GB Macs.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .models import resolve_model_path


@dataclass
class Segment:
    start: float
    end:   float
    text:  str


def transcribe_audio(
    audio_path: str | Path,
    model_tier: str = "small.en",
    language: str | None = None,       # None → auto-detect
    progress_cb: Callable[[dict], None] | None = None,
) -> tuple[list[Segment], dict]:
    """Transcribe an audio file with faster-whisper.

    Returns ``(segments, info)`` where ``info`` includes::

        {
          "language":             "en",
          "language_probability": 0.99,
          "duration":             2832.4,   # seconds
          "model_used":           "small.en",
          "elapsed_s":            ...,
        }

    Raises ``FileNotFoundError`` if the model tier isn't installed — callers
    should surface this so the UI can prompt to install it.
    """
    # resolve_model_path picks the best available location for this tier:
    # the app-managed dir if present, else HF hub cache, else the env-dir
    # override, else common system paths. Users who already have a model
    # elsewhere never re-download.
    model_dir = resolve_model_path(model_tier)
    if model_dir is None:
        raise FileNotFoundError(
            f"Whisper model {model_tier!r} not installed. "
            f"Run `openreply whisper download {model_tier}` "
            f"(or install it via Settings → Whisper models)."
        )
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "Install the video extra: pip install -e '.[video]'"
        ) from e

    t0 = time.time()
    model = WhisperModel(
        str(model_dir),
        device="cpu",
        compute_type="int8",
        num_workers=1,
    )
    seg_iter, info = model.transcribe(
        str(audio_path),
        beam_size=1,
        vad_filter=True,
        language=language,
    )

    segments: list[Segment] = []
    total_dur = max(float(info.duration or 1.0), 1e-6)
    for s in seg_iter:
        segments.append(Segment(float(s.start), float(s.end), (s.text or "").strip()))
        if progress_cb:
            progress_cb({
                "stage": "transcribe",
                "pct": round(min(1.0, float(s.end) / total_dur) * 100, 1),
                "current_s": float(s.end),
                "total_s":   total_dur,
            })

    elapsed = round(time.time() - t0, 2)
    meta = {
        "language": info.language,
        "language_probability": round(float(info.language_probability), 3),
        "duration": float(info.duration or 0.0),
        "model_used": model_tier,
        "elapsed_s": elapsed,
    }
    if progress_cb:
        progress_cb({"stage": "transcribe", "pct": 100, "done": True, **meta})
    return segments, meta
