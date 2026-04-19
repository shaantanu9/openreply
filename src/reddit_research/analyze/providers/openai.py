from __future__ import annotations

import os

from .base import LLMProvider


# OpenAI-compatible endpoints. All of these accept the same /chat/completions
# shape as OpenAI itself, so one SDK covers them via base_url override.
_PROVIDER_CONFIG = {
    "openai":     {"env": "OPENAI_API_KEY",     "base_url": None,
                   "default_model": "gpt-4o-mini"},
    "openrouter": {"env": "OPENROUTER_API_KEY", "base_url": "https://openrouter.ai/api/v1",
                   "default_model": "anthropic/claude-sonnet-4-6"},
    "groq":       {"env": "GROQ_API_KEY",       "base_url": "https://api.groq.com/openai/v1",
                   "default_model": "llama-3.3-70b-versatile"},
    "deepseek":   {"env": "DEEPSEEK_API_KEY",   "base_url": "https://api.deepseek.com/v1",
                   "default_model": "deepseek-chat"},
    "mistral":    {"env": "MISTRAL_API_KEY",    "base_url": "https://api.mistral.ai/v1",
                   "default_model": "mistral-large-latest"},
    "google":     {"env": "GOOGLE_API_KEY",
                   "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
                   "default_model": "gemini-2.0-flash"},
}


class OpenAIProvider(LLMProvider):
    """OpenAI-compatible provider covering OpenAI + 5 drop-in APIs.

    Which provider gets used is controlled by the constructor arg (routed from
    resolve_provider()) or the LLM_PROVIDER env var. The model is LLM_MODEL
    from env, falling back to a provider-specific default.
    """

    def __init__(self, provider: str | None = None, model: str | None = None) -> None:
        try:
            from openai import OpenAI
        except ImportError as e:
            raise RuntimeError(
                "Install the analyze extra: pip install -e '.[analyze]'"
            ) from e

        prov = (provider or os.getenv("LLM_PROVIDER") or "openai").lower()
        if prov not in _PROVIDER_CONFIG:
            raise ValueError(
                f"Unsupported OpenAI-compatible provider: {prov}. "
                f"Must be one of: {', '.join(_PROVIDER_CONFIG)}."
            )
        cfg = _PROVIDER_CONFIG[prov]
        api_key = os.getenv(cfg["env"])
        if not api_key:
            raise RuntimeError(f"{cfg['env']} not set in environment.")

        # The instance `name` identifies which provider this is, so callers
        # (and logs) can see `mistral` / `groq` rather than the generic "openai".
        self.name = prov
        self._client = OpenAI(api_key=api_key, base_url=cfg["base_url"])
        # LLM_MODEL is the single source of truth for model choice;
        # per-provider default only kicks in if nothing is set.
        self._model = model or os.getenv("LLM_MODEL") or cfg["default_model"]

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
