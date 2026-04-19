"""LLM provider abstraction — Anthropic / OpenAI / Ollama behind one interface."""
from __future__ import annotations

import os
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


# Env-key for each named provider. Shared so resolve_provider and
# enrich_from_llm stay in sync.
_PROVIDER_ENV_KEY = {
    "anthropic":  "ANTHROPIC_API_KEY",
    "openai":     "OPENAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "groq":       "GROQ_API_KEY",
    "deepseek":   "DEEPSEEK_API_KEY",
    "mistral":    "MISTRAL_API_KEY",
    "google":     "GOOGLE_API_KEY",
}


def _ollama_reachable() -> bool:
    try:
        import urllib.request
        base = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
        with urllib.request.urlopen(f"{base}/api/version", timeout=1):
            return True
    except Exception:
        return False


def resolve_provider(explicit: str | None = None) -> str:
    """Pick the provider the user actually has configured.

    Priority: explicit arg → LLM_PROVIDER env (if its key/Ollama is usable) →
    first env key that's set → reachable Ollama → ValueError.

    Used as the default across every extractor so nothing silently hardcodes
    Anthropic. Callers pass their `--provider` flag through unchanged.
    """
    if explicit:
        return explicit.lower()
    configured = (os.getenv("LLM_PROVIDER") or "").lower()
    if configured == "ollama" and _ollama_reachable():
        return "ollama"
    if configured in _PROVIDER_ENV_KEY and os.getenv(_PROVIDER_ENV_KEY[configured]):
        return configured
    for name, env_key in _PROVIDER_ENV_KEY.items():
        if os.getenv(env_key):
            return name
    if _ollama_reachable():
        return "ollama"
    raise RuntimeError(
        "No LLM provider configured. Add a key in Settings → API keys, "
        "or start a local Ollama instance."
    )


def get_provider(name: str | None = None) -> LLMProvider:
    """Lazy-import concrete provider. Passing `name=None` auto-detects."""
    resolved = resolve_provider(name)
    if resolved == "anthropic":
        from .anthropic import AnthropicProvider
        return AnthropicProvider()
    if resolved in ("openai", "openrouter", "groq", "deepseek", "mistral", "google"):
        from .openai import OpenAIProvider
        return OpenAIProvider(provider=resolved)
    if resolved == "ollama":
        from .ollama import OllamaProvider
        return OllamaProvider()
    raise ValueError(f"Unknown provider: {resolved}.")
