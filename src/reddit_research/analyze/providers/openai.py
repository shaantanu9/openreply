from __future__ import annotations

from ...core.config import load_config
from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, model: str = "gpt-4o-mini") -> None:
        try:
            from openai import OpenAI
        except ImportError as e:
            raise RuntimeError(
                "Install the analyze extra: pip install -e '.[analyze]'"
            ) from e

        cfg = load_config()
        if not cfg.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not set in environment.")
        self._client = OpenAI(api_key=cfg.openai_api_key)
        self._model = model

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return (resp.choices[0].message.content or "").strip()
