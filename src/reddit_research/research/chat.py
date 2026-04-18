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
from collections.abc import Iterator

from ..core.config import load_config
from ..core.db import get_db

# --- provider registry -----------------------------------------------------

_OPENAI_COMPATIBLE = {
    "openai":     ("OPENAI_API_KEY",     None,                                 "gpt-4o-mini"),
    "openrouter": ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1",        "anthropic/claude-sonnet-4-6"),
    "groq":       ("GROQ_API_KEY",       "https://api.groq.com/openai/v1",      "llama-3.3-70b-versatile"),
    "deepseek":   ("DEEPSEEK_API_KEY",   "https://api.deepseek.com/v1",         "deepseek-chat"),
    "mistral":    ("MISTRAL_API_KEY",    "https://api.mistral.ai/v1",           "mistral-large-latest"),
    "google":     ("GOOGLE_API_KEY",     "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-2.0-flash"),
    "ollama":     (None,                 None,                                  "llama3.1"),
}


def _ollama_base_url() -> str:
    return (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/") + "/v1"


def _auto_detect_provider() -> str | None:
    """Pick the first provider whose key is present in env."""
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    for name, (env_key, _, _) in _OPENAI_COMPATIBLE.items():
        if env_key and os.getenv(env_key):
            return name
    # Ollama needs no key — but only pick it if the user explicitly configured a URL.
    if os.getenv("OLLAMA_BASE_URL"):
        return "ollama"
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


# --- topic context --------------------------------------------------------

def _topic_context(topic: str, limit_posts: int = 8) -> str:
    """Build a compact markdown context block for the LLM."""
    db = get_db()

    # Painpoints / features / products / workarounds
    findings = {}
    for kind in ("painpoint", "feature_wish", "product", "workaround"):
        rows = db.query(
            "SELECT label, metadata_json FROM graph_nodes "
            "WHERE topic=? AND kind=? "
            "ORDER BY (SELECT count(*) FROM graph_edges e "
            "          WHERE e.topic=graph_nodes.topic "
            "            AND (e.src=graph_nodes.id OR e.dst=graph_nodes.id)) DESC "
            "LIMIT 12",
            (topic, kind),
        )
        findings[kind] = [r["label"] for r in rows]

    # Source breakdown
    sources = db.query(
        "SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS n "
        "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
        "WHERE tp.topic=? "
        "GROUP BY coalesce(p.source_type,'reddit') "
        "ORDER BY n DESC",
        (topic,),
    )

    # A small sample of the most-engaged posts for concrete evidence
    posts = db.query(
        "SELECT p.title, p.subreddit, p.score, p.num_comments, "
        "       coalesce(p.source_type,'reddit') AS source, substr(coalesce(p.selftext,''),1,400) AS snip "
        "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
        "WHERE tp.topic=? "
        "ORDER BY coalesce(p.score,0)+coalesce(p.num_comments,0) DESC "
        "LIMIT ?",
        (topic, limit_posts),
    )

    parts = [f"# Topic: {topic}", ""]

    if sources:
        parts.append("## Source breakdown")
        for s in sources:
            parts.append(f"- **{s['source']}** — {s['n']} posts")
        parts.append("")

    for kind, label in (
        ("painpoint", "Painpoints"),
        ("workaround", "DIY workarounds (strong gap signals)"),
        ("product", "Products complained about"),
        ("feature_wish", "Feature wishes"),
    ):
        items = findings.get(kind) or []
        if items:
            parts.append(f"## {label}")
            for i in items[:10]:
                parts.append(f"- {i}")
            parts.append("")

    if posts:
        parts.append("## Evidence posts (most engaged)")
        for p in posts:
            origin = f"r/{p['subreddit']}" if p.get("subreddit") else p["source"]
            parts.append(
                f"- [{origin}, {p['score']}↑ · {p['num_comments']}c] "
                f"{p['title']}\n  > {p['snip'].strip()[:300]}"
            )
        parts.append("")

    return "\n".join(parts)


# --- prompt modes ---------------------------------------------------------

MODE_PROMPTS: dict[str, str] = {
    "ask": (
        "Answer the user's question using the topic context below. "
        "Cite specific painpoints, workarounds, or evidence posts where relevant. "
        "Prefer bullet points. If you don't have enough evidence, say so honestly."
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
        "and whether any existing competitor does it. Use markdown with short paragraphs."
    ),
    "sources": (
        "Summarize what each data source uniquely contributes. "
        "One bullet per source describing the dominant signal from that corpus, "
        "then a 2-sentence synthesis across all sources. Keep it tight."
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
        "Quote evidence verbatim where possible."
    )


def build_user_prompt(topic: str, question: str, mode: str) -> str:
    context = _topic_context(topic)
    instruction = MODE_PROMPTS.get(mode, MODE_PROMPTS["ask"])
    return (
        f"{instruction}\n\n"
        f"--- TOPIC CONTEXT ---\n"
        f"{context}\n"
        f"--- USER QUESTION ---\n"
        f"{question.strip() or '(follow the instruction above for the default response)'}"
    )


# --- streaming callers ----------------------------------------------------

def _stream_anthropic(model: str, system: str, user: str, max_tokens: int) -> Iterator[str]:
    from anthropic import Anthropic

    cfg = load_config()
    if not cfg.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = Anthropic(api_key=cfg.anthropic_api_key)
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
        extra_headers["HTTP-Referer"] = "https://github.com/shaantanu98/reddit-myind"
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


def chat_stream(
    topic: str,
    question: str,
    *,
    mode: str = "ask",
    provider: str | None = None,
    max_tokens: int = 1800,
) -> Iterator[str]:
    """Stream tokens from the selected provider."""
    prov, model = _resolve_provider(provider)
    user = build_user_prompt(topic, question, mode)
    sys = system_prompt()

    if prov == "anthropic":
        yield from _stream_anthropic(model, sys, user, max_tokens)
    elif prov in _OPENAI_COMPATIBLE:
        yield from _stream_openai_compatible(prov, model, sys, user, max_tokens)
    else:
        raise RuntimeError(f"Unknown provider: {prov}")


def chat_meta(topic: str, provider: str | None = None) -> dict:
    """Return a small dict describing what will be used + the current corpus size."""
    prov, model = _resolve_provider(provider)
    db = get_db()
    posts = db.query("SELECT count(*) AS n FROM topic_posts WHERE topic=?", (topic,))
    return {
        "topic": topic,
        "provider": prov,
        "model": model,
        "posts": posts[0]["n"] if posts else 0,
    }
