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
    # NVIDIA NIM — OpenAI-compatible endpoint at integrate.api.nvidia.com.
    # Catalogue at https://build.nvidia.com (~136 ids). NOT every listed
    # id is actually serving — some return HTTP 400 "DEGRADED function
    # cannot be invoked" or HTTP 410 "end of life". Verified-working as
    # of 2026-04-25: meta/llama-3.3-70b-instruct, meta/llama-3.1-8b-
    # instruct, mistralai/mixtral-8x22b-instruct-v0.1, google/gemma-3-
    # 27b-it, nvidia/llama-3.1-nemotron-70b-instruct. Override with
    # LLM_MODEL; see byok.js's curated chip list for the user-facing set.
    "nvidia":     {"env": "NVIDIA_API_KEY",
                   "base_url": "https://integrate.api.nvidia.com/v1",
                   "default_model": "meta/llama-3.3-70b-instruct"},
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
        # Cap every HTTP request so a hung connection (NVIDIA NIM cold-boot,
        # OpenRouter 502 with no body, etc.) can't pin the Tauri daemon
        # mutex indefinitely. Default 300s safely covers 30-90s
        # sentiment/audience-build runs; user can override via
        # LLM_REQUEST_TIMEOUT=N in their .env (Ollama has its own
        # OLLAMA_TIMEOUT for the same reason).
        timeout_s = float(os.getenv("LLM_REQUEST_TIMEOUT") or 300.0)
        self._client = OpenAI(api_key=api_key, base_url=cfg["base_url"], timeout=timeout_s)
        # `LLM_MODEL` is per-provider. When the user pins LLM_PROVIDER=ollama
        # with LLM_MODEL=llama3.2:3b and the FallbackProvider walks down to
        # OpenRouter / Groq / etc., we must NOT pass that Ollama model name
        # to a cloud API — OpenRouter will reject "llama3.2:3b" with a
        # 400 ("not a valid model identifier"), Groq will 404, etc., and
        # every fallback attempt fails for what looks like an unrelated
        # reason. Only honour LLM_MODEL when the user's pinned provider
        # matches THIS provider; otherwise use the per-provider default.
        # See `extraction_queue.last_error` rows: "openrouter: 400 -
        # 'llama3.2:3b is not a valid model'" — that is this bug.
        pinned = (os.getenv("LLM_PROVIDER") or "").lower()
        env_model = os.getenv("LLM_MODEL") if pinned == prov else None
        self._model = model or env_model or cfg["default_model"]

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
