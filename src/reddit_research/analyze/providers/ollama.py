from __future__ import annotations

import os

from ...core.config import load_config
from .base import LLMProvider


# Families that can't do chat-style completions — filter them out when
# auto-picking a default model. OCR = specialty models like glm-ocr;
# bert/nomic-bert = embedding models; most names with "embed" are vectors.
_NON_CHAT_FAMILIES = {"bert", "nomic-bert", "glmocr"}


def _autopick_ollama_model(base_url: str) -> str | None:
    """Pick the first installed chat-capable **local** model.

    Skips:
      - Embeddings models (names containing "embed").
      - OCR models (names containing "ocr").
      - Non-chat families (bert, glmocr, …) listed in _NON_CHAT_FAMILIES.
      - Ollama cloud-gated models (any name ending `:cloud` — those require
        an upstream key and hit 401 otherwise, silently breaking enrichment).
    """
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
        lo = name.lower()
        if "embed" in lo or "ocr" in lo:
            continue
        if lo.endswith(":cloud"):
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
        # Resolution order: explicit arg → LLM_MODEL env (but ONLY if the
        # user also picked ollama as LLM_PROVIDER — otherwise LLM_MODEL is a
        # cloud-model string that Ollama doesn't recognize) → auto-pick first
        # installed chat-capable model → legacy llama3.1 (last-resort).
        env_model = (
            os.getenv("LLM_MODEL")
            if (os.getenv("LLM_PROVIDER") or "").lower() == "ollama"
            else None
        )
        self._model = (
            model
            or env_model
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
        import os
        import httpx

        # num_ctx = Ollama's prompt context window. Default is 4096 tokens,
        # which truncates any corpus prompt with >~30 post excerpts. Silent
        # truncation → model sees half the corpus → garbage JSON. Bump to
        # 8192 for extraction workloads. User can override with OLLAMA_NUM_CTX.
        import os as _os
        try:
            num_ctx = int(_os.getenv("OLLAMA_NUM_CTX") or 8192)
        except ValueError:
            num_ctx = 8192
        payload = {
            "model": self._model,
            "prompt": prompt,
            "system": system or "",
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
                "num_ctx": num_ctx,
            },
        }
        # Structured-output mode for small models. Every extractor in this
        # codebase asks the model to emit a JSON list/object — small models
        # (llama3.2:3b, gemma3:4b) frequently ignore that and add prose,
        # causing `_parse_json` to fail and enrichment to report 0 items.
        # Ollama's `format: "json"` flag constrains generation to valid JSON
        # output, which is a huge reliability win on small local models.
        # Heuristic: turn it on whenever the system prompt mentions "JSON"
        # (the extractor prompts all do). No-op for chat/free-form calls.
        if system and ("json" in system.lower() or "JSON" in system):
            payload["format"] = "json"
        # Generation timeout. Small local models (e.g. llama3.2:3b on CPU)
        # need 2–5 min on prompts with 100+ corpus excerpts. 120s was too
        # short and produced silent failures ("enrich failed: timed out").
        # Default bumped to 600s; override with OLLAMA_TIMEOUT env var.
        try:
            timeout_s = float(os.getenv("OLLAMA_TIMEOUT") or 600.0)
        except ValueError:
            timeout_s = 600.0
        r = httpx.post(f"{self._base}/api/generate", json=payload, timeout=timeout_s)
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
