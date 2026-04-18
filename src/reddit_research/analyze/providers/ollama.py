from __future__ import annotations

from ...core.config import load_config
from .base import LLMProvider


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, model: str = "llama3.1") -> None:
        try:
            import httpx  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "Install the analyze extra: pip install -e '.[analyze]'"
            ) from e
        cfg = load_config()
        self._base = cfg.ollama_base_url.rstrip("/")
        self._model = model

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
        r.raise_for_status()
        return (r.json().get("response") or "").strip()
