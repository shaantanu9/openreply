"""Shared embedding-function factory — switch between default MiniLM and
multilingual paraphrase-MiniLM via the ``GAPMAP_EMBEDDING_MODEL`` env var.

Why this lives in its own module:

The app has four independent consumers of ChromaDB's embedding function —
``research/relevance.py``, ``retrieval/cluster.py``, ``graph/relations.py``
and ``retrieval/palace.py`` all historically instantiated
``embedding_functions.DefaultEmbeddingFunction()`` directly. That MiniLM-L6-v2
ONNX model is English-leaning; users researching non-English markets
(Spanish app-store reviews, German developer forums, Japanese subreddits)
hit poor recall.

This factory centralises the choice so a single env flag flips all four
paths. Two modes:

  * ``"default"`` (unset or any value other than ``"multilingual"``) →
    ChromaDB's bundled ``all-MiniLM-L6-v2`` ONNX embedder. Zero extra
    deps, offline, ~80 MB cached. Existing behaviour.
  * ``"multilingual"`` → sentence-transformers'
    ``paraphrase-multilingual-MiniLM-L12-v2`` (50+ languages). Requires
    the ``sentence-transformers`` extra. Falls back to default + logs a
    warning if the package isn't importable, so users who set the env
    var in a lean DMG build still get results instead of a crash.

Set once per run:

    GAPMAP_EMBEDDING_MODEL=multilingual gapmap research collect --topic ...
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any

logger = logging.getLogger(__name__)


# Model name for the multilingual path. Kept as a module constant so tests /
# future env-overrides can target it.
_MULTILINGUAL_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"

# Cache the resolved embedding function — ChromaDB's default embedder has a
# ~2–5 s cold start (ONNX compile), and sentence-transformers first load is
# similar for the multilingual variant. Keyed by mode so switching env vars
# mid-process (tests, chained CLI invocations) still works.
_EF_CACHE: dict[str, Any] = {}

# Serialises the cold model load. Without this, a parallel fan-out (e.g. the
# external-source pool in research.collect runs 6 workers) has every thread
# see an empty cache at once and each load its own ONNX/sentence-transformers
# model simultaneously — N× the memory + CPU contention turns a ~5 s cold
# start into 60-90 s of thrash, which then blows the per-pool timeout and
# every source returns 0. One loader, the rest wait on the warm cache.
_EF_LOCK = threading.Lock()


def _resolve_mode() -> str:
    """Return normalised mode string. Defaults to ``default``.

    Honours both the legacy ``GAPMAP_EMBEDDING_MODEL`` (multilingual /
    default) and the newer ``GAPMAP_EMBEDDING_BACKEND`` (mlx / onnx /
    multilingual / default). Backend wins when both are set.
    """
    backend = (os.getenv("GAPMAP_EMBEDDING_BACKEND") or "").strip().lower()
    if backend in ("mlx", "onnx", "multilingual", "default"):
        if backend == "default":
            # Allow `default` as an explicit "use whatever auto-resolves to"
            # signal — falls through to autodetect.
            pass
        else:
            return backend
    raw = (os.getenv("GAPMAP_EMBEDDING_MODEL") or "").strip().lower()
    if raw == "multilingual":
        return "multilingual"
    # Autodetect: prefer MLX on Apple Silicon when available, else default ONNX.
    try:
        from .embedder_mlx import is_active_for_environment
        if is_active_for_environment(force=None):
            return "mlx"
    except Exception:
        pass
    return "default"


def _default_ef():
    """ChromaDB's bundled all-MiniLM-L6-v2 ONNX embedder (offline)."""
    from chromadb.utils import embedding_functions
    return embedding_functions.DefaultEmbeddingFunction()


def _multilingual_ef():
    """Sentence-transformers paraphrase-multilingual-MiniLM-L12-v2.

    Falls back to the default embedder (with a logged warning) when
    ``sentence-transformers`` isn't installed — keeps lean DMG builds
    functional even if a user sets ``GAPMAP_EMBEDDING_MODEL=multilingual``.
    """
    try:
        from chromadb.utils import embedding_functions
        return embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=_MULTILINGUAL_MODEL,
        )
    except Exception as e:
        logger.warning(
            "embedder: multilingual mode requested but sentence-transformers "
            "unavailable (%s) — falling back to default MiniLM. Install with "
            "`uv pip install sentence-transformers` for non-English recall.",
            e,
        )
        return _default_ef()


def get_embedding_function():
    """Return the shared ChromaDB-compatible embedding function.

    Callers use this in place of ``embedding_functions.DefaultEmbeddingFunction()``
    — the returned object is callable: ``fn(["some", "texts"]) -> [[...], [...]]``.

    Returns ``None`` when chromadb itself isn't importable; callers already
    guard for that via their own ``_embeddings_available()`` checks.
    """
    try:
        import chromadb  # noqa: F401
    except ImportError:
        return None

    mode = _resolve_mode()
    cached = _EF_CACHE.get(mode)
    if cached is not None:
        return cached

    # Double-checked locking: only one thread pays the cold-load cost; any
    # other thread that raced in waits here and then returns the warm cache.
    with _EF_LOCK:
        cached = _EF_CACHE.get(mode)
        if cached is not None:
            return cached

        if mode == "mlx":
            try:
                from .embedder_mlx import get_mlx_embedding_function
                fn = get_mlx_embedding_function()
                if fn is None:
                    logger.warning(
                        "embedder: MLX backend requested but unavailable — "
                        "falling back to default ONNX MiniLM. Install with "
                        "`uv pip install mlx mlx_embeddings` on Apple Silicon."
                    )
                    fn = _default_ef()
            except Exception as e:
                logger.warning("embedder: MLX init failed (%s) — falling back to ONNX.", e)
                fn = _default_ef()
        elif mode == "multilingual":
            fn = _multilingual_ef()
        else:
            fn = _default_ef()
        _EF_CACHE[mode] = fn
        return fn


def active_backend() -> str:
    """Return a short label for the currently-active backend.
    Used by the doctor + status tools to surface which embedder is live."""
    return _resolve_mode()


__all__ = ["get_embedding_function", "active_backend"]
