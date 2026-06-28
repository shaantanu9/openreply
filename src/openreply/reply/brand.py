"""Brand profile — now a thin view over the *active Agent*.

Kept for backward compatibility with the reply engine (`opportunity.py`,
`generate.py`), which speaks in "brand" shape. The active agent IS the brand:
`get_brand()` projects the agent into the brand shape the engine expects, and
`set_brand()` updates (or creates) the active agent.
"""
from __future__ import annotations

from . import agent as _agent


def _to_brand(a: dict | None) -> dict | None:
    if not a:
        return None
    return {
        "id": a["id"],
        "name": a["name"],
        "url": a.get("url", ""),
        "description": a.get("brand") or a.get("niche") or "",
        "keywords": a.get("keywords", []),
        "persona": a.get("persona", ""),
        "tone": a.get("tone", "helpful, concise, non-salesy"),
        "platforms": a.get("platforms", ["reddit_free"]),
    }


def get_brand() -> dict | None:
    return _to_brand(_agent.get_active_agent())


def set_brand(
    *,
    name: str | None = None,
    url: str | None = None,
    description: str | None = None,
    keywords: list[str] | None = None,
    persona: str | None = None,
    tone: str | None = None,
    platforms: list[str] | None = None,
) -> dict:
    active = _agent.get_active_agent()
    if not active:
        return _to_brand(
            _agent.create_agent(
                name=name or "Default Agent",
                niche=description or "",
                persona=persona or "",
                tone=tone or "helpful, concise, non-salesy",
                keywords=keywords,
                platforms=platforms,
            )
        )
    return _to_brand(
        _agent.update_agent(
            active["id"],
            name=name,
            niche=description,
            persona=persona,
            tone=tone,
            keywords=keywords,
            platforms=platforms,
        )
    )
