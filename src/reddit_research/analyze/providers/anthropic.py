from __future__ import annotations

from ...core.config import load_config
from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, model: str = "claude-sonnet-4-6") -> None:
        # Lazy import — only fails if user actually invokes analyze
        try:
            from anthropic import Anthropic
        except ImportError as e:
            raise RuntimeError(
                "Install the analyze extra: pip install -e '.[analyze]'"
            ) from e

        cfg = load_config()
        if not cfg.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set in environment.")
        self._client = Anthropic(api_key=cfg.anthropic_api_key)
        self._model = model

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> str:
        msg = self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system or "",
            messages=[{"role": "user", "content": prompt}],
        )
        # Concatenate text blocks
        parts = [b.text for b in msg.content if getattr(b, "type", "") == "text"]
        return "\n".join(parts).strip()
