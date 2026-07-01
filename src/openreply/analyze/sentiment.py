"""LLM sentiment classification, aggregated per source_type."""
from __future__ import annotations

import json
from typing import Any

_BATCH_PROMPT = """Rate the sentiment of each numbered text toward the product it discusses.
Return STRICT JSON: an array of floats in [-1,1] (one per input, same order).
-1 = very negative/complaint, 0 = neutral, 1 = very positive.
Texts:
{items}
Return only the JSON array."""


def _call_llm(prompt: str, provider: str | None = None) -> str:
    from .providers.base import get_provider

    return get_provider(provider).complete(prompt, max_tokens=1024)


def _corpus_for(topic: str, limit: int):
    from ..research.collect import corpus_for

    return corpus_for(topic, limit=limit)


def classify_batch(texts: list[str], provider: str | None = None) -> list[float]:
    if not texts:
        return []
    items = "\n".join(f"{i+1}. {t[:300]}" for i, t in enumerate(texts))
    try:
        raw = _call_llm(_BATCH_PROMPT.format(items=items), provider=provider)
        s, e = raw.find("["), raw.rfind("]")
        arr = json.loads(raw[s : e + 1])
        vals = [max(-1.0, min(1.0, float(x))) for x in arr]
    except Exception:
        return [0.0] * len(texts)
    if len(vals) < len(texts):
        vals += [0.0] * (len(texts) - len(vals))
    return vals[: len(texts)]


def _bucket(score: float) -> str:
    return "pos" if score > 0.2 else "neg" if score < -0.2 else "neu"


def sentiment_by_source(
    topic: str, *, limit: int = 200, provider: str | None = None
) -> dict[str, Any]:
    posts = list(_corpus_for(topic, limit))
    texts = [f"{p.get('title','')} {p.get('selftext','')}".strip() for p in posts]
    scores = classify_batch(texts, provider=provider)
    by_source: dict[str, dict[str, Any]] = {}
    total = 0.0
    for p, sc in zip(posts, scores):
        src = p.get("source_type") or "unknown"
        b = by_source.setdefault(src, {"score": 0.0, "n": 0, "pos": 0, "neg": 0, "neu": 0})
        b["n"] += 1
        b[_bucket(sc)] += 1
        b["score"] += sc
        total += sc
    for b in by_source.values():
        b["score"] = round(b["score"] / b["n"], 3) if b["n"] else 0.0
    overall = round(total / len(scores), 3) if scores else 0.0
    return {"overall": overall, "by_source": by_source}
