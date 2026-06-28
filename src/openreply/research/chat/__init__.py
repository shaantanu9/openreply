"""Chat with a collected topic — streaming LLM answers grounded in the corpus.

Supported providers:
  - anthropic  (native SDK, streaming)
  - openai, openrouter, groq, deepseek, mistral, google, ollama (OpenAI-compatible)

The provider + model come from the env (LLM_PROVIDER / LLM_MODEL) or can be
passed explicitly. If nothing is configured, we auto-detect the first provider
whose key is present.

The chat function is a generator that yields text chunks — callers can either
print them live (CLI streaming) or concatenate into one string.
"""
from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator

from ...core.config import load_config
from ...core.db import get_db

# Provider resolution + streaming + test/introspection extracted to
# chat/llm_dispatch.py (testable in isolation). Re-exported here so existing
# `from openreply.research.chat import _resolve_provider / test_provider / ...`
# imports keep working.
from .llm_dispatch import (  # noqa: E402
    OPENAI_COMPATIBLE,
    _OPENAI_COMPATIBLE,
    _auto_detect_provider,
    _default_model,
    _ollama_base_url,
    _resolve_provider,
    _stream_anthropic,
    _stream_openai_compatible,
    _stream_timeout,
    auto_detect_provider,
    default_model,
    list_ollama_models,
    resolve_provider,
    stream_for_provider,
    test_provider,
)


# --- topic context --------------------------------------------------------

# Palace timeout wrapper extracted to chat/timeout.py (unit-tested in isolation).
from .timeout import (  # noqa: E402
    PALACE_CHAT_TIMEOUT,
    _PALACE_CHAT_TIMEOUT,
    _call_with_timeout,
    call_with_timeout,
)


# Corpus grounding (semantic retrieval + context assembly + sources block)
# extracted to chat/retrieval_context.py (testable + probeable via chat doctor).
from .retrieval_context import (  # noqa: E402
    _format_sources_block,
    _semantic_evidence,
    _topic_context,
)

# `chat doctor` — one-call topic readiness probe (corpus / palace / provider).
from .doctor import (  # noqa: E402
    diagnose as chat_doctor,
    format_report as format_doctor_report,
)


MODE_PROMPTS: dict[str, str] = {
    "ask": (
        "Answer the user's question using the topic context below. "
        "Treat cross-source corroborated signals as primary: prioritize findings backed by 2+ sources "
        "and relation edges. Cite specific painpoints/workarounds/evidence posts and mention source overlap. "
        "Mark any single-source claim as tentative. Prefer bullet points. If evidence is insufficient, say so."
    ),
    "plan": (
        "Produce a concrete 1-week validation plan for building a product in this space. "
        "Include: (1) which 5 users to talk to and where to find them, "
        "(2) the top 3 painpoint hypotheses to validate, "
        "(3) a minimum-viable prototype to test, "
        "(4) a go/no-go metric. Use numbered bullets."
    ),
    "features": (
        "List the top 5 features to build, sorted by (pain × gap × evidence strength). "
        "For each feature provide: name, who it's for, the painpoint it solves, "
        "and whether any existing competitor does it. Prioritize painpoints validated across multiple sources; "
        "label single-source signals as tentative. Use markdown with short paragraphs."
    ),
    "sources": (
        "Summarize what each data source uniquely contributes. "
        "One bullet per source describing the dominant signal from that corpus, "
        "then a 2-sentence synthesis across all sources based on cross-source relation overlap. Keep it tight."
    ),
    "bullets": (
        "Give me only bullet-point learnings. Three sections: "
        "(a) what users want, (b) what they DIY today, (c) the biggest gap. "
        "Nothing else — no intros or conclusions."
    ),
}


def system_prompt() -> str:
    return (
        "You are a senior product researcher. You analyze multi-source corpora "
        "(Reddit, HN, app stores, arXiv, etc.) to identify market gaps. "
        "Ground every claim in the context you're given — do not hallucinate. "
        "Quote evidence verbatim where possible. "
        "When you reference an evidence post from the Evidence section, cite it "
        "inline with its bracketed number, e.g. \"users complain about X [3]\". "
        "Do NOT invent citation numbers — only use ones present in the Evidence "
        "section. Do NOT add a Sources / References list yourself; one will be "
        "appended automatically after your response."
    )


def build_user_prompt(topic: str, question: str, mode: str,
                      citations_out: list | None = None) -> str:
    # Pass the user's question into _topic_context so Palace can retrieve
    # semantically-relevant evidence posts instead of blind top-engagement.
    # `citations_out` is filled in-place with the numbered evidence list so
    # `chat_stream` can append the Sources block after the LLM finishes.
    context = _topic_context(topic, question=question, citations_out=citations_out)
    instruction = MODE_PROMPTS.get(mode, MODE_PROMPTS["ask"])
    return (
        f"{instruction}\n\n"
        f"--- TOPIC CONTEXT ---\n"
        f"{context}\n"
        f"--- USER QUESTION ---\n"
        f"{question.strip() or '(follow the instruction above for the default response)'}"
    )


# --- streaming callers ----------------------------------------------------
# _stream_timeout / _stream_anthropic / _stream_openai_compatible now live in
# chat/llm_dispatch.py (imported at the top of this module).


def chat_stream(
    topic: str,
    question: str,
    *,
    mode: str = "ask",
    provider: str | None = None,
    max_tokens: int = 1800,
) -> Iterator[str]:
    """Stream tokens from the selected provider, then append a citations block.

    Two layers of citation:
      1. The context block numbers each evidence post `[N]` and the system
         prompt instructs the LLM to reference them inline. LLM cooperation
         varies — bigger models tend to cite, smaller ones often forget.
      2. After the stream completes, this function yields a deterministic
         `## Sources` block listing every evidence post with title + URL.
         That guarantees the user always sees source attribution, even
         when the LLM didn't bother with inline `[N]` markers.
    """
    prov, model = _resolve_provider(provider)
    citations: list[dict] = []
    user = build_user_prompt(topic, question, mode, citations_out=citations)
    sys = system_prompt()

    if prov == "anthropic":
        yield from _stream_anthropic(model, sys, user, max_tokens)
    elif prov in _OPENAI_COMPATIBLE:
        yield from _stream_openai_compatible(prov, model, sys, user, max_tokens)
    else:
        raise RuntimeError(f"Unknown provider: {prov}")

    # Append the deterministic Sources block once the LLM stream finishes.
    # Yielding as a single chunk so the frontend's incremental markdown
    # renderer paints it atomically — easier than streaming a partial
    # heading character-by-character.
    sources_block = _format_sources_block(citations)
    if sources_block:
        yield sources_block


# Agent mode (tool-use loop) extracted to chat/agent_tools.py.
from .agent_tools import (  # noqa: E402
    AGENT_TOOLS,
    _exec_tool,
    _run_bounded,
    agent_stream_anthropic,
)


# ─── Test + introspection helpers ─────────────────────────────────────────
# test_provider() and list_ollama_models() now live in chat/llm_dispatch.py
# (imported at the top of this module).


# chat_meta extracted to chat/meta.py.
from .meta import chat_meta  # noqa: E402
