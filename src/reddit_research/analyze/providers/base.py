"""LLM provider abstraction — Anthropic / OpenAI / Ollama behind one interface."""
from __future__ import annotations

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Minimal surface: one `complete()` call. No streaming in MVP."""

    name: str = "base"

    @abstractmethod
    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> str:
        ...


def get_provider(name: str) -> LLMProvider:
    """Lazy-import concrete provider to keep base dep-free."""
    name = name.lower()
    if name == "anthropic":
        from .anthropic import AnthropicProvider

        return AnthropicProvider()
    if name == "openai":
        from .openai import OpenAIProvider

        return OpenAIProvider()
    if name == "ollama":
        from .ollama import OllamaProvider

        return OllamaProvider()
    raise ValueError(f"Unknown provider: {name}. Use anthropic, openai, or ollama.")
