"""LLM provider resolution + streaming + test/introspection.

Everything about WHICH provider/model to use and HOW to stream tokens from it
lives here, isolated from the corpus/retrieval logic. Providers:
  - anthropic            (native SDK, streaming)
  - openai, openrouter, groq, deepseek, mistral, google, nvidia, ollama
                         (OpenAI-compatible, streaming)

Extracted from the old monolithic chat.py so provider/model resolution and the
streaming round-trips can be tested in isolation (no corpus/DB needed). Public
names are re-exported from chat/__init__.py so existing imports keep working.
"""
from __future__ import annotations

import json
import os
from collections.abc import Iterator

from ...core.config import load_config

# --- provider registry -----------------------------------------------------

_OPENAI_COMPATIBLE = {
    "openai":     ("OPENAI_API_KEY",     None,                                 "gpt-4o-mini"),
    "openrouter": ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1",        "anthropic/claude-sonnet-4-6"),
    "groq":       ("GROQ_API_KEY",       "https://api.groq.com/openai/v1",      "llama-3.3-70b-versatile"),
    "deepseek":   ("DEEPSEEK_API_KEY",   "https://api.deepseek.com/v1",         "deepseek-chat"),
    "mistral":    ("MISTRAL_API_KEY",    "https://api.mistral.ai/v1",           "mistral-large-latest"),
    "google":     ("GOOGLE_API_KEY",     "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-2.0-flash"),
    # NVIDIA NIM — OpenAI-compatible. Browse models at https://build.nvidia.com.
    "nvidia":     ("NVIDIA_API_KEY",     "https://integrate.api.nvidia.com/v1", "meta/llama-3.3-70b-instruct"),
    # Last-resort default — only used if LLM_MODEL isn't set AND the live /api/tags
    # autopick also returns nothing. `gemma3:4b` is a broadly-available chat model.
    "ollama":     (None,                 None,                                  "gemma3:4b"),
}


def _ollama_base_url() -> str:
    return (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/") + "/v1"


def _auto_detect_provider() -> str | None:
    """Pick the first provider whose key is present in env.

    Fallback: if no paid key is set, try to ping a local Ollama.
    """
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    for name, (env_key, _, _) in _OPENAI_COMPATIBLE.items():
        if env_key and os.getenv(env_key):
            return name
    # Ollama: user-set URL wins, else probe default localhost.
    if os.getenv("OLLAMA_BASE_URL"):
        return "ollama"
    try:
        import urllib.request
        with urllib.request.urlopen("http://localhost:11434/api/version", timeout=1):
            return "ollama"
    except Exception:
        return None


def _resolve_provider(provider: str | None) -> tuple[str, str]:
    prov = (provider or os.getenv("LLM_PROVIDER") or _auto_detect_provider() or "").lower()
    if not prov:
        raise RuntimeError(
            "No LLM provider configured. Set a key in Settings → API keys, "
            "or export one of ANTHROPIC_API_KEY / OPENAI_API_KEY / "
            "OPENROUTER_API_KEY / GROQ_API_KEY / etc."
        )
    model = os.getenv("LLM_MODEL") or _default_model(prov)
    return prov, model


def _default_model(provider: str) -> str:
    if provider == "anthropic":
        return "claude-sonnet-4-6"
    if provider in _OPENAI_COMPATIBLE:
        return _OPENAI_COMPATIBLE[provider][2]
    return "gpt-4o-mini"


# --- streaming -------------------------------------------------------------

# Without an explicit timeout the OpenAI/Anthropic SDKs default to a 600 s
# ceiling, so a provider that accepts the connection then stalls mid-stream
# (the classic "NVIDIA socket stall" / "ollama runner crashed mid-load") leaves
# the chat process hung for up to 10 minutes with zero tokens and no exit — the
# UI spins until its 5-minute watchdog gives up. A short connect timeout fails
# fast when the endpoint is unreachable; a generous read timeout tolerates a
# slow free-tier first token (queue waits of 30-90 s are common) while still
# bounding a genuine mid-stream stall to ~2 minutes.
def _stream_timeout():
    import httpx
    return httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)


def _stream_anthropic(model: str, system: str, user: str, max_tokens: int) -> Iterator[str]:
    from anthropic import Anthropic

    cfg = load_config()
    if not cfg.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = Anthropic(api_key=cfg.anthropic_api_key, timeout=_stream_timeout())
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        for text in stream.text_stream:
            yield text


def _stream_openai_compatible(
    provider: str, model: str, system: str, user: str, max_tokens: int
) -> Iterator[str]:
    from openai import OpenAI

    env_key, base_url, _ = _OPENAI_COMPATIBLE[provider]
    if provider == "ollama":
        api_key = "ollama"
        base = _ollama_base_url()
    else:
        api_key = os.getenv(env_key) if env_key else None
        if not api_key:
            raise RuntimeError(f"{env_key} not set")
        base = base_url

    client = OpenAI(api_key=api_key, base_url=base)
    extra_headers = {}
    if provider == "openrouter":
        from ...core.identity import GITHUB_URL
        extra_headers["HTTP-Referer"] = GITHUB_URL
        extra_headers["X-Title"] = "Gap Map"

    stream = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        stream=True,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        extra_headers=extra_headers or None,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None)
        if text:
            yield text


def stream_for_provider(
    prov: str, model: str, system: str, user: str, max_tokens: int
) -> Iterator[str]:
    """Dispatch to the right streamer for `prov`. Raises on unknown provider."""
    if prov == "anthropic":
        yield from _stream_anthropic(model, system, user, max_tokens)
    elif prov in _OPENAI_COMPATIBLE:
        yield from _stream_openai_compatible(prov, model, system, user, max_tokens)
    else:
        raise RuntimeError(f"Unknown provider: {prov}")


# --- test + introspection --------------------------------------------------

def test_provider(provider: str | None = None, model: str | None = None) -> dict:
    """Tiny round-trip ping. Returns {ok, provider, model, latency_ms, reply, error?}."""
    import time

    # Did the CALLER explicitly pick this provider (e.g. BYOK Test button on
    # the Anthropic row)? If so, we must NOT fall back to LLM_MODEL — that
    # env var carries the user's CURRENTLY-SELECTED default model, which
    # is usually for a DIFFERENT provider. Sending an NVIDIA model name to
    # Anthropic produces a misleading 401/404. Use per-provider defaults
    # instead so each Test row pings its own provider correctly.
    explicit_provider = bool(provider)
    prov = (provider or os.getenv("LLM_PROVIDER") or _auto_detect_provider() or "").lower()
    if not prov:
        return {"ok": False, "error": "no provider configured"}

    if model:
        mdl = model                                # caller supplied → trust
    elif explicit_provider:
        mdl = _default_model(prov)                 # per-provider default (no env fallback)
    else:
        mdl = os.getenv("LLM_MODEL") or _default_model(prov)

    t0 = time.time()
    try:
        if prov == "anthropic":
            from anthropic import Anthropic
            cfg = load_config()
            if not cfg.anthropic_api_key:
                return {"ok": False, "provider": prov, "error": "ANTHROPIC_API_KEY not set"}
            client = Anthropic(api_key=cfg.anthropic_api_key, timeout=_stream_timeout())
            resp = client.messages.create(
                model=mdl, max_tokens=20,
                messages=[{"role": "user", "content": "Reply with just: OK"}],
            )
            reply = " ".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        elif prov in _OPENAI_COMPATIBLE:
            from openai import OpenAI
            env_key, base_url, _ = _OPENAI_COMPATIBLE[prov]
            if prov == "ollama":
                api_key = "ollama"; base = _ollama_base_url()
            else:
                api_key = os.getenv(env_key) if env_key else None
                if not api_key:
                    return {"ok": False, "provider": prov, "error": f"{env_key} not set"}
                base = base_url
            client = OpenAI(api_key=api_key, base_url=base, timeout=_stream_timeout())
            resp = client.chat.completions.create(
                model=mdl, max_tokens=20,
                messages=[{"role": "user", "content": "Reply with just: OK"}],
            )
            reply = (resp.choices[0].message.content or "").strip()
        else:
            return {"ok": False, "error": f"unknown provider: {prov}"}
    except Exception as e:
        return {
            "ok": False, "provider": prov, "model": mdl,
            "latency_ms": int((time.time() - t0) * 1000),
            "error": str(e),
        }

    return {
        "ok": True, "provider": prov, "model": mdl,
        "latency_ms": int((time.time() - t0) * 1000),
        "reply": reply[:80],
    }


def list_ollama_models() -> dict:
    """Query the Ollama /api/tags endpoint for installed models."""
    import urllib.request

    base = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
    try:
        with urllib.request.urlopen(f"{base}/api/tags", timeout=3) as r:
            body = r.read().decode("utf-8")
        data = json.loads(body)
        models = []
        for m in data.get("models", []) or []:
            name = m.get("name") or m.get("model")
            if not name:
                continue
            # Skip embedding-only models (heuristic on family names)
            fam = (m.get("details", {}) or {}).get("family") or ""
            if fam in ("bert", "nomic-bert") or "embed" in name.lower():
                continue
            models.append({
                "name": name,
                "size_mb": round((m.get("size") or 0) / (1024 * 1024)),
                "family": fam,
                "param_size": (m.get("details", {}) or {}).get("parameter_size", ""),
            })
        return {"ok": True, "url": base, "models": models}
    except Exception as e:
        return {"ok": False, "url": base, "error": str(e)}


# Public aliases (the rest of the codebase imports the underscore names).
resolve_provider = _resolve_provider
default_model = _default_model
auto_detect_provider = _auto_detect_provider
OPENAI_COMPATIBLE = _OPENAI_COMPATIBLE
