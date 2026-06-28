"""MLX-backed embedding function for ChromaDB on Apple Silicon.

Wraps an MLX sentence-transformer-style model in the ChromaDB
``EmbeddingFunction`` interface so it can be plugged into a Chroma
collection identically to the bundled ONNX MiniLM embedder.

Resolution order (callers go through ``embedder.get_embedding_function``):

  1. ``OPENREPLY_EMBEDDING_BACKEND`` env explicit (``mlx`` | ``onnx`` | ``multilingual``)
  2. Apple Silicon detected (``platform.processor() == 'arm'``) AND ``mlx``
     importable AND a model is available → MLX
  3. Fall back to the existing ONNX path

If MLX import fails for any reason (Intel Mac, Linux, missing model
files, sentence-transformers not installed), this module returns
``None`` and the caller falls back to ONNX. We never crash the pipeline
because of a backend choice.

Default model: ``mlx-community/multilingual-e5-base-mlx`` — 768 dim,
multilingual, ~280 MB. Good middle-ground between MiniLM (384, English)
and bge-large (1024, slower). Override with
``OPENREPLY_MLX_EMBEDDING_MODEL=...``.
"""
from __future__ import annotations

import logging
import os
import platform
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_MLX_MODEL = "mlx-community/multilingual-e5-base-mlx"

_EF_CACHE: dict[str, Any] = {}


def _is_apple_silicon() -> bool:
    if platform.system() != "Darwin":
        return False
    proc = (platform.processor() or "").lower()
    machine = (platform.machine() or "").lower()
    return "arm" in proc or "arm64" in machine or "aarch64" in machine


def _mlx_available() -> bool:
    """Return True iff MLX itself + an embedding loader are importable.
    The actual model download/load is deferred to first-call so probing
    is cheap."""
    try:
        import mlx.core  # noqa: F401
    except Exception:
        return False
    # Either mlx_embeddings (community wrapper) or sentence-transformers
    # with mlx backend — try both.
    try:
        import mlx_embeddings  # noqa: F401
        return True
    except Exception:
        pass
    try:
        # `sentence_transformers` won't auto-route to MLX, but if the
        # user has it we can still fall through to a CPU/torch run.
        # Treat this as "not MLX" so the ONNX path stays.
        return False
    except Exception:
        return False


def is_active_for_environment(force: str | None = None) -> bool:
    """Decide whether the MLX backend should serve embeddings here.

    ``force`` is the value of ``OPENREPLY_EMBEDDING_BACKEND`` after
    normalisation. Explicit ``mlx`` always wins (and surfaces a clear
    error later if the import fails); explicit ``onnx`` always loses;
    everything else autodetects.
    """
    if force == "mlx":
        return True
    if force in ("onnx", "default", "multilingual"):
        return False
    return _is_apple_silicon() and _mlx_available()


class _MLXEmbeddingFunction:
    """ChromaDB-compatible embedding function backed by mlx_embeddings.

    Loads the model lazily on first call so module import doesn't pay
    the ~1-2s cold-start every time.
    """

    def __init__(self, model_name: str = DEFAULT_MLX_MODEL):
        self._model_name = model_name
        self._model = None
        self._tokenizer = None

    # ChromaDB looks at this attribute to label the collection's
    # embedding function. Returning a stable string means the collection
    # remembers which backend wrote the vectors and can warn on a
    # mismatch.
    def name(self) -> str:
        return f"mlx::{self._model_name}"

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        try:
            from mlx_embeddings.utils import load
            self._model, self._tokenizer = load(self._model_name)
        except Exception as e:
            raise RuntimeError(
                f"mlx_embeddings load failed for {self._model_name!r}: {e}"
            ) from e

    def __call__(self, input: list[str]) -> list[list[float]]:  # noqa: A002
        if not input:
            return []
        self._ensure_loaded()
        # mlx_embeddings exposes a `generate` helper that returns L2-normalised
        # vectors. Some versions name it differently — try both.
        try:
            from mlx_embeddings.utils import generate_batch
            vecs = generate_batch(self._model, self._tokenizer, input)
        except Exception:
            try:
                from mlx_embeddings.utils import generate
                vecs = [generate(self._model, self._tokenizer, t) for t in input]
            except Exception as e:
                raise RuntimeError(f"mlx generate failed: {e}") from e
        out: list[list[float]] = []
        for v in vecs:
            try:
                out.append([float(x) for x in v])
            except TypeError:
                # ndarray / mlx array — last-resort coercion.
                out.append([float(x) for x in list(v)])
        return out


def get_mlx_embedding_function() -> Any | None:
    """Return a cached MLX embedding function, or ``None`` when MLX
    isn't usable in this environment."""
    if not _mlx_available():
        return None
    model_name = (os.getenv("OPENREPLY_MLX_EMBEDDING_MODEL") or "").strip() or DEFAULT_MLX_MODEL
    cached = _EF_CACHE.get(model_name)
    if cached is not None:
        return cached
    try:
        ef = _MLXEmbeddingFunction(model_name)
        _EF_CACHE[model_name] = ef
        return ef
    except Exception as e:
        logger.warning("MLX embedder init failed: %s — falling back to ONNX.", e)
        return None


__all__ = [
    "DEFAULT_MLX_MODEL",
    "is_active_for_environment",
    "get_mlx_embedding_function",
]
