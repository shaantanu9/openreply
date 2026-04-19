from __future__ import annotations

import os

from ...core.config import load_config
from .base import LLMProvider


# Families that can't do chat-style completions — filter them out when
# auto-picking a default model. OCR = specialty models like glm-ocr;
# bert/nomic-bert = embedding models; most names with "embed" are vectors.
_NON_CHAT_FAMILIES = {"bert", "nomic-bert", "glmocr"}


def _autopick_ollama_model(base_url: str) -> str | None:
    """Pick the first installed chat-capable model. Skips embeddings + OCR."""
    try:
        import httpx
        r = httpx.get(f"{base_url.rstrip('/')}/api/tags", timeout=3.0)
        r.raise_for_status()
        data = r.json()
    except Exception:
        return None
    for m in data.get("models", []) or []:
        name = m.get("name") or m.get("model") or ""
        if not name:
            continue
        if "embed" in name.lower() or "ocr" in name.lower():
            continue
        fam = (m.get("details", {}) or {}).get("family") or ""
        if fam in _NON_CHAT_FAMILIES:
            continue
        return name
    return None


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, model: str | None = None) -> None:
        try:
            import httpx  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "Install the analyze extra: pip install -e '.[analyze]'"
            ) from e
        cfg = load_config()
        self._base = cfg.ollama_base_url.rstrip("/")
        # Resolution order: explicit arg → LLM_MODEL env → auto-pick first
        # installed chat-capable model → legacy llama3.1 (last-resort).
        self._model = (
            model
            or os.getenv("LLM_MODEL")
            or _autopick_ollama_model(self._base)
            or "llama3.1"
        )

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> str:
        import httpx

        payload = {
            "model": self._model,
            "prompt": prompt,
            "system": system or "",
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        r = httpx.post(f"{self._base}/api/generate", json=payload, timeout=120.0)
        # Surface Ollama's actual error text (e.g. "unable to load model X")
        # instead of a generic 4xx so the UI can give targeted guidance.
        if r.status_code >= 400:
            try:
                err = r.json().get("error", "")
            except Exception:
                err = r.text[:200]
            raise RuntimeError(
                f"Ollama {r.status_code} for model {self._model!r}: {err or r.reason_phrase}"
            )
        return (r.json().get("response") or "").strip()
