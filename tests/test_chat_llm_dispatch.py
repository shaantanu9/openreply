"""Unit tests for chat/llm_dispatch.py — provider resolution in isolation.

No network, no DB: we only exercise the pure resolution/registry logic. Streaming
round-trips (test_provider / _stream_*) need live providers, so they're not unit-
tested here — but they're now isolated in one module that can be integration-
tested separately.
"""
import pytest

from gapmap.research.chat import llm_dispatch as ld


def test_default_models_per_provider():
    assert ld._default_model("anthropic") == "claude-sonnet-4-6"
    assert ld._default_model("groq") == "llama-3.3-70b-versatile"
    assert ld._default_model("openrouter") == "anthropic/claude-sonnet-4-6"
    assert ld._default_model("totally-unknown") == "gpt-4o-mini"


def test_resolve_provider_explicit_uses_per_provider_default(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    prov, model = ld._resolve_provider("groq")
    assert prov == "groq"
    assert model == "llama-3.3-70b-versatile"


def test_resolve_provider_honours_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o")
    prov, model = ld._resolve_provider(None)
    assert prov == "openai"
    assert model == "gpt-4o"


def test_resolve_provider_raises_when_nothing_configured(monkeypatch):
    for k in (
        "LLM_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
        "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "GOOGLE_API_KEY",
        "NVIDIA_API_KEY", "OLLAMA_BASE_URL",
    ):
        monkeypatch.delenv(k, raising=False)
    # Don't let auto-detect probe a real localhost Ollama during the test.
    monkeypatch.setattr(ld, "_auto_detect_provider", lambda: None)
    with pytest.raises(RuntimeError, match="No LLM provider configured"):
        ld._resolve_provider(None)


def test_auto_detect_prefers_anthropic(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert ld._auto_detect_provider() == "anthropic"


def test_auto_detect_picks_first_openai_compatible_key(monkeypatch):
    for k in ("ANTHROPIC_API_KEY",):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    assert ld._auto_detect_provider() == "groq"


def test_public_aliases_and_registry():
    assert ld.resolve_provider is ld._resolve_provider
    assert ld.default_model is ld._default_model
    assert ld.OPENAI_COMPATIBLE is ld._OPENAI_COMPATIBLE
    # registry covers every OpenAI-compatible provider the UI advertises
    for p in ("openai", "openrouter", "groq", "deepseek", "mistral", "google", "nvidia", "ollama"):
        assert p in ld._OPENAI_COMPATIBLE
