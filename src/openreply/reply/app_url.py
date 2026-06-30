"""Parse an app/website URL into agent-form fields.

Supports:
- Apple App Store (apps.apple.com/.../id<track_id>)
- Google Play Store (play.google.com/store/apps/details?id=<app_id>)
- Generic websites (via Jina Reader)

Fetched content is passed to the configured LLM and returned as a JSON blob
that matches the agent create/update form fields. All values are suggestions —
the caller should render them in editable inputs so the user can refine before
saving.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..analyze.providers.base import get_provider
from ..sources.web_reader import _jina_read

_APPLE_RE = re.compile(r"/id(\d+)")
_PLAY_RE = re.compile(r"[?&]id=([a-zA-Z0-9._-]+)")


def _normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def _extract_apple_track_id(url: str) -> str | None:
    m = _APPLE_RE.search(url)
    return m.group(1) if m else None


def _extract_play_app_id(url: str) -> str | None:
    m = _PLAY_RE.search(url)
    return m.group(1) if m else None


def _fetch_apple_metadata(track_id: str) -> dict[str, Any]:
    """Fetch App Store metadata via iTunes lookup."""
    from ..sources._http import polite_get

    try:
        r = polite_get("https://itunes.apple.com/lookup", params={"id": track_id}, timeout=15)
        r.raise_for_status()
        results = r.json().get("results") or []
        if not results:
            return {"source_text": "", "url_type": "appstore", "error": "No App Store result found."}
        app = results[0]
        parts = [
            f"Name: {app.get('trackName', '')}",
            f"Seller: {app.get('sellerName', '')}",
            f"Genres: {', '.join(app.get('genres', []))}",
            f"Description:\n{app.get('description', '')}",
        ]
        return {"source_text": "\n\n".join(parts), "url_type": "appstore", "website": app.get("sellerUrl", "")}
    except Exception as e:
        return {"source_text": "", "url_type": "appstore", "error": f"App Store fetch failed: {e}"}


def _fetch_play_metadata(app_id: str) -> dict[str, Any]:
    """Fetch Play Store metadata via google-play-scraper."""
    try:
        import google_play_scraper as gps  # type: ignore
    except ImportError as e:
        return {"source_text": "", "url_type": "playstore", "error": "google-play-scraper not installed."}

    try:
        app = gps.app(app_id, lang="en", country="us")
        parts = [
            f"Name: {app.get('title', '')}",
            f"Developer: {app.get('developer', '')}",
            f"Genre: {app.get('genre', '')}",
            f"Description:\n{app.get('description', '')}",
        ]
        return {"source_text": "\n\n".join(parts), "url_type": "playstore", "website": app.get("developerWebsite", "")}
    except Exception as e:
        return {"source_text": "", "url_type": "playstore", "error": f"Play Store fetch failed: {e}"}


def _fetch_website(url: str) -> dict[str, Any]:
    text = _jina_read(url)
    if text is None:
        return {"source_text": "", "url_type": "website", "error": "Could not fetch the URL."}
    return {"source_text": text[:8000], "url_type": "website", "website": ""}


def _fetch_context(url: str) -> dict[str, Any]:
    url = _normalize_url(url)

    track_id = _extract_apple_track_id(url)
    if track_id:
        ctx = _fetch_apple_metadata(track_id)
        ctx["url"] = url
        return ctx

    app_id = _extract_play_app_id(url)
    if app_id:
        ctx = _fetch_play_metadata(app_id)
        ctx["url"] = url
        return ctx

    ctx = _fetch_website(url)
    ctx["url"] = url
    return ctx


_SYSTEM_PROMPT = """You are a helpful product-marketing assistant. Given the content of an app store listing or website, fill out an OpenReply agent profile.

Return ONLY a JSON object with these keys and no extra commentary:
{
  "name": "short product/brand name",
  "brand": "brand or product name (defaults to name)",
  "niche": "one-line niche / market",
  "website": "domain or full URL if known, else empty string",
  "goal": "what this agent should achieve, e.g. drive trial signups",
  "product": "what the product offers — the value it can recommend",
  "persona": "voice / background, e.g. founder, ex-teacher, engineer",
  "tone": "writing style, e.g. helpful, concise, non-salesy",
  "audience": "who the product is for",
  "keywords": ["topic1", "topic2", "topic3"],
  "platforms": ["reddit_free", "hn", "lemmy", "mastodon", "devto", "stackoverflow", "producthunt"]
}

Guidelines:
- Keep values concise and concrete.
- Derive keywords from the product category, use cases, and audience pain points.
- Platforms is a list of source keys; default to the example list unless the content strongly suggests others.
- If a value cannot be inferred, use an empty string (or empty array) rather than guessing.
- Do not wrap the JSON in markdown code fences."""


def parse_app_url(url: str) -> dict[str, Any]:
    """Fetch an app/website URL and return suggested agent-form fields.

    The result always contains:
      - url, url_type, ok (bool)
      - fields: name, brand, niche, website, goal, product, persona, tone,
        audience, keywords, platforms
      - error (string) if fetching or the LLM call failed
    """
    ctx = _fetch_context(url)
    if ctx.get("error"):
        return {
            "ok": False,
            "url": ctx.get("url", url),
            "url_type": ctx.get("url_type", "unknown"),
            "error": ctx["error"],
            "fields": _empty_fields(),
        }

    source = ctx.get("source_text", "")
    if not source.strip():
        return {
            "ok": False,
            "url": ctx.get("url", url),
            "url_type": ctx.get("url_type", "unknown"),
            "error": "No content could be extracted from the URL.",
            "fields": _empty_fields(),
        }

    prompt = (
        f"URL: {ctx.get('url', url)}\n\n"
        f"Extracted content:\n{source}\n\n"
        "Fill the OpenReply agent profile JSON."
    )

    try:
        provider = get_provider()
        raw = provider.complete(prompt, system=_SYSTEM_PROMPT, max_tokens=2048, temperature=0.2)
        fields = _extract_json(raw)
    except Exception as e:
        return {
            "ok": False,
            "url": ctx.get("url", url),
            "url_type": ctx.get("url_type", "unknown"),
            "error": f"LLM extraction failed: {e}",
            "fields": _empty_fields(),
        }

    # Prefer the website we extracted explicitly if the LLM left it blank.
    inferred_website = ctx.get("website", "")
    if inferred_website and not fields.get("website"):
        fields["website"] = inferred_website

    # Normalize array fields.
    for k in ("keywords", "platforms"):
        v = fields.get(k)
        if isinstance(v, str):
            fields[k] = [x.strip() for x in v.split(",") if x.strip()]
        elif not isinstance(v, list):
            fields[k] = []

    # Defaults for safety.
    defaults = _empty_fields()
    for k, v in defaults.items():
        fields.setdefault(k, v)

    return {
        "ok": True,
        "url": ctx.get("url", url),
        "url_type": ctx.get("url_type", "unknown"),
        "provider": getattr(provider, "name", "unknown"),
        "error": None,
        "fields": fields,
    }


def _empty_fields() -> dict[str, Any]:
    return {
        "name": "",
        "brand": "",
        "niche": "",
        "website": "",
        "goal": "",
        "product": "",
        "persona": "",
        "tone": "helpful, concise, non-salesy",
        "audience": "",
        "keywords": [],
        "platforms": ["reddit_free", "hn", "lemmy", "mastodon", "devto", "stackoverflow", "producthunt"],
    }


def _extract_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from an LLM response."""
    text = (text or "").strip()
    # Strip markdown fences if present.
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
    if text.endswith("```"):
        text = text.rsplit("\n", 1)[0]
    text = text.strip()
    # Find the first JSON object.
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in LLM response.")
    return json.loads(text[start:end + 1])
