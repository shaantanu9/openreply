"""Gap extraction — runs the 4 externalized extractors over a topic corpus.

Each extractor is a YAML file in prompts/ (painpoints, features, complaints, diy).
LLM provider is pluggable (anthropic/openai/ollama).

Every extractor returns a structured JSON list. We retry JSON parsing once
after stripping code fences; if it still fails we surface the raw text
rather than crashing so Claude can salvage it downstream.
"""
from __future__ import annotations

import json
from typing import Any

from ..analyze.providers.base import get_provider
from .collect import corpus_for, corpus_temporal_split
from .prompts import load_extractor


def _format_corpus(rows: list[dict[str, Any]]) -> str:
    parts = []
    for r in rows:
        selftext = (r.get("selftext") or "")[:600]
        parts.append(
            f"[{r['id']}] (r/{r['sub']}, {r.get('num_comments',0)}c {r.get('score',0)}↑) "
            f"{r.get('title','')}\n{selftext}"
        )
    return "\n\n".join(parts)


def _parse_json(raw: str) -> list[dict] | dict:
    cleaned = raw.strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"_raw": raw, "_parse_error": True}


def run_extractor(
    extractor: str,
    topic: str,
    provider: str = "anthropic",
    corpus_limit: int = 120,
    min_score: int = 1,
    max_tokens: int = 2048,
) -> list[dict] | dict:
    """Run a single extractor ('painpoints', 'features', 'complaints', 'diy')."""
    rows = corpus_for(topic, limit=corpus_limit, min_score=min_score)
    if not rows:
        return []
    ext = load_extractor(extractor)
    corpus = _format_corpus(rows)
    user = ext["user_template"].format(topic=topic, corpus=corpus)
    raw = get_provider(provider).complete(
        prompt=user,
        system=ext["system"],
        max_tokens=max_tokens,
        temperature=0.2,
    )
    return _parse_json(raw)


def find_temporal_gaps(
    topic: str,
    provider: str = "anthropic",
    per_bucket: int = 80,
    min_score: int = 1,
    max_tokens: int = 3000,
) -> list[dict] | dict:
    """Classify pain points by temporal pattern (chronic/emerging/fading).

    Requires a corpus with both pre-May-2025 (historical) and post-May-2025
    (recent) data. Use `collect(..., include_historical=True)` beforehand.
    """
    split = corpus_temporal_split(
        topic=topic, limit_per_bucket=per_bucket, min_score=min_score
    )
    pre, post = split["pre_2025"], split["post_2025"]
    if not pre and not post:
        return {"_error": f"No corpus for topic={topic!r}. Run collect first."}
    if not pre:
        return {"_error": "No pre-May-2025 data. Run collect --historical / --aggressive first."}
    if not post:
        return {"_error": "No post-May-2025 data. Run a current-mode collect first."}

    ext = load_extractor("temporal_gaps")
    user = ext["user_template"].format(
        topic=topic,
        pre_corpus=_format_corpus(pre),
        post_corpus=_format_corpus(post),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=max_tokens, temperature=0.2
    )
    return _parse_json(raw)


def find_gaps(
    topic: str,
    provider: str = "anthropic",
    corpus_limit: int = 120,
    min_score: int = 1,
) -> dict[str, Any]:
    """Run all four extractors and return a consolidated gap report."""
    out: dict[str, Any] = {"topic": topic, "provider": provider, "corpus_size": None}
    rows = corpus_for(topic, limit=corpus_limit, min_score=min_score)
    out["corpus_size"] = len(rows)
    if not rows:
        out["error"] = f"No corpus found for topic={topic!r}. Run `reddit-cli research collect` first."
        return out

    for key, file in (
        ("painpoints", "painpoints"),
        ("feature_wishes", "features"),
        ("product_complaints", "complaints"),
        ("diy_workarounds", "diy"),
    ):
        out[key] = run_extractor(
            file, topic, provider=provider, corpus_limit=corpus_limit, min_score=min_score
        )
    return out
