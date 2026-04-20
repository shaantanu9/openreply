"""LLM provider abstraction — Anthropic / OpenAI / Ollama behind one interface.

Resilience: `get_provider()` with no explicit name returns a FallbackProvider
that iterates configured providers and falls through on transient failure
(Ollama runner crash, 5xx, network hiccups, wrong key). Every call site that
used to hard-fail on a single-provider error now picks up the next configured
provider transparently — no change required at the call site.
"""
from __future__ import annotations

import json
import os
import urllib.request
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

# Order of auto-detect fallback when no explicit preference fits. Cloud
# providers first (generally more reliable than a local runner under load).
# Anthropic prioritized because the default prompts were tuned on Claude.
_FALLBACK_ORDER = [
    "anthropic", "openai", "openrouter",
    "groq", "deepseek", "google", "mistral",
]


def _ollama_reachable() -> bool:
    try:
        base = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
        with urllib.request.urlopen(f"{base}/api/version", timeout=1):
            return True
    except Exception:
        return False


def _ollama_model_ready(model: str | None) -> bool:
    """Server-up doesn't mean the model can actually generate. The llama
    runner can crash independently (observed failure mode: "Ollama 500 for
    model X: llama runner process no longer running"). Probe /api/show for
    the target model — 200 means the model is loaded and callable.

    No model configured → treat as "ready" so we don't spuriously skip the
    ollama branch when LLM_MODEL is unset (the provider will pick a sane
    default itself).
    """
    if not model:
        return True
    try:
        base = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
        req = urllib.request.Request(
            f"{base}/api/show",
            data=json.dumps({"name": model}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def _ollama_usable() -> bool:
    """Full health check — server reachable AND configured model is loaded."""
    return _ollama_reachable() and _ollama_model_ready(os.getenv("LLM_MODEL"))


def build_fallback_chain(preferred: str | None = None) -> list[str]:
    """Ordered list of providers to try, best-first.

    1. Explicit `preferred` arg (caller's --provider flag), if it looks
       usable — but we still append the rest so a transient failure on the
       preferred one falls through.
    2. `LLM_PROVIDER` env (user's Settings-selected default), same rule.
    3. Every cloud provider whose env key is set, in _FALLBACK_ORDER.
    4. Local Ollama as last resort if its server is reachable.

    A provider gets included even if its health probe currently fails —
    transient network hiccups shouldn't bar it permanently. The chain walker
    catches per-provider exceptions and moves on.

    Ollama is skipped from the chain entirely if the server isn't even
    reachable: every attempt would waste a socket timeout. Cloud providers
    are skipped when their key isn't set (the constructor would raise).
    """
    chain: list[str] = []

    def _add(name: str | None) -> None:
        if not name:
            return
        n = name.lower()
        if n in chain:
            return
        if n == "ollama" and not _ollama_reachable():
            return
        if n in _PROVIDER_ENV_KEY and not os.getenv(_PROVIDER_ENV_KEY[n]):
            return
        chain.append(n)

    _add(preferred)
    _add(os.getenv("LLM_PROVIDER"))
    for name in _FALLBACK_ORDER:
        _add(name)
    _add("ollama")  # catch-all if the user has only Ollama set up
    return chain


def resolve_provider(explicit: str | None = None) -> str:
    """Return the *name string* of the preferred provider (first of the chain).

    ⚠️  Do NOT use this to actually call an LLM — it returns just the name
        like "anthropic" / "openai" / "ollama". If you instantiate a raw
        provider off this name you LOSE the FallbackProvider chain that
        makes "cloud dead → fall through to Ollama" work transparently.

    Correct uses (all of these want the *name*, not a provider instance):
      - Pre-flight gate: `resolve_provider(None)` to raise if no LLM configured
      - Branching on provider name: `if resolve_provider() == "ollama": ...`
      - CLI arg construction: `args.append(resolve_provider())` for a subprocess
      - Logging: `log.info(f"using {resolve_provider()}")`

    For everything else — actual LLM calls — use `get_provider(name=None)`
    which returns a FallbackProvider walking the full chain. That's the
    canonical path; this function is only the naming helper.

    Raises RuntimeError with a user-facing message if no provider is
    configured at all.
    """
    chain = build_fallback_chain(explicit)
    if not chain:
        raise RuntimeError(
            "No LLM provider configured. Add a key in Settings → API keys, "
            "or start a local Ollama instance."
        )
    return chain[0]


def _build_single_provider(name: str) -> LLMProvider:
    if name == "anthropic":
        from .anthropic import AnthropicProvider
        return AnthropicProvider()
    if name in ("openai", "openrouter", "groq", "deepseek", "mistral", "google"):
        from .openai import OpenAIProvider
        return OpenAIProvider(provider=name)
    if name == "ollama":
        from .ollama import OllamaProvider
        return OllamaProvider()
    raise ValueError(f"Unknown provider: {name}.")


class FallbackProvider(LLMProvider):
    """Tries each provider in its chain on every `complete()` call. First
    successful response wins. Aggregates errors across attempts so the final
    exception shows which providers were tried and why each failed.

    The chain is recomputed every call — so if the user saves a new key in
    Settings mid-session, the very next enrichment call picks it up without
    a process restart. Cheap: env-var reads plus (at most) one `/api/version`
    ping when Ollama is a candidate.
    """

    def __init__(self, chain: list[str] | None = None):
        self._pinned_chain = chain
        self.name = "fallback"

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> str:
        chain = self._pinned_chain or build_fallback_chain()
        if not chain:
            raise RuntimeError(
                "No LLM provider configured. Add a key in Settings → API keys, "
                "or start a local Ollama instance."
            )
        errors: list[str] = []
        # The `LLM_MODEL` env var is only meaningful for the provider the user
        # actively picked (LLM_PROVIDER). If we're trying Ollama as *fallback*
        # from another provider, LLM_MODEL is some cloud-model string that
        # Ollama doesn't know about — we must not probe /api/show against it.
        llm_model = os.getenv("LLM_MODEL") if (os.getenv("LLM_PROVIDER") or "").lower() == "ollama" else None
        for name in chain:
            # Last-mile skip: if Ollama's server is flat-out unreachable,
            # every attempt would waste a socket timeout. If it's reachable
            # but the pinned model crashed we still try — the provider itself
            # will raise and the chain walker will catch it.
            if name == "ollama":
                if not _ollama_reachable():
                    errors.append("ollama: server unreachable")
                    continue
                if llm_model and not _ollama_model_ready(llm_model):
                    errors.append(f"ollama: model {llm_model!r} not ready")
                    continue
            try:
                provider = _build_single_provider(name)
                self.name = f"fallback:{name}"  # reflect which provider served
                return provider.complete(prompt, system, max_tokens, temperature)
            except Exception as e:
                errors.append(f"{name}: {type(e).__name__}: {e}")
                continue
        raise RuntimeError(
            f"All configured LLM providers failed — tried {len(chain)}. "
            f"Details: {' | '.join(errors)}"
        )


def get_provider(name: str | None = None) -> LLMProvider:
    """Return a provider instance.

    - `name=None` → FallbackProvider walking the full chain each call.
      Callers that previously hard-failed on a single-provider error now
      get transparent fall-through (Ollama dead → next cloud key, etc.).
    - `name=<str>` → single-provider instance. No fallback. Used when the
      caller truly wants to pin a specific provider (e.g. `reddit-cli
      analyze themes --provider anthropic`).
    """
    if name:
        return _build_single_provider(resolve_provider(name))
    chain = build_fallback_chain()
    if not chain:
        raise RuntimeError(
            "No LLM provider configured. Add a key in Settings → API keys, "
            "or start a local Ollama instance."
        )
    if len(chain) == 1:
        return _build_single_provider(chain[0])
    return FallbackProvider(chain)
