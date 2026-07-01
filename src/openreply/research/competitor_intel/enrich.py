"""Seed enricher — given a competitor name, propose aliases/subreddit/URLs via LLM."""
from __future__ import annotations

import json
from typing import Any

_PROMPT = """You are helping identify a software competitor's online footprint.
Given the product name{website}, return STRICT JSON with keys:
  aliases: array of alternate names / domains / social handles (max 5)
  subreddits: array of subreddit names WITHOUT the r/ prefix (max 3)
  urls: object mapping any of {{producthunt, appstore, playstore, trustpilot, g2, website}} to a full https URL you are confident about (omit unknown)
  category: one short product category string
Product name: {name}
Return only the JSON object, no prose."""


def _call_llm(prompt: str, provider: str | None = None) -> str:
    """Thin LLM call — isolated so tests can monkeypatch it."""
    from ...analyze.providers.base import get_provider

    p = get_provider(provider)
    return p.complete(prompt, max_tokens=512)  # provider.complete → str


def _empty() -> dict[str, Any]:
    return {"aliases": [], "subreddits": [], "urls": {}, "category": ""}


def enrich_seed(name: str, *, website: str = "", provider: str | None = None) -> dict[str, Any]:
    site_clause = f" (website: {website})" if website else ""
    prompt = _PROMPT.format(name=name, website=site_clause)
    try:
        raw = _call_llm(prompt, provider=provider)
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start : end + 1]) if start >= 0 else {}
    except Exception:
        return _empty()
    out = _empty()
    if isinstance(data.get("aliases"), list):
        out["aliases"] = [str(x) for x in data["aliases"]][:5]
    if isinstance(data.get("subreddits"), list):
        out["subreddits"] = [str(x).removeprefix("r/").strip("/") for x in data["subreddits"]][:3]
    if isinstance(data.get("urls"), dict):
        out["urls"] = {k: str(v) for k, v in data["urls"].items() if str(v).startswith("http")}
    if data.get("category") is not None:
        out["category"] = str(data["category"])
    return out
