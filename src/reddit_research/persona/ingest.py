"""Persona ingest — read newly-collected posts, LLM-filter by the persona's
lens, distill 1-3 sentence lessons, write to ``persona_memories``.

Streaming-friendly: every entrypoint returns a generator of progress dicts.
Callers either iterate (CLI/sidecar) or `list(...)` (one-shot scripts).
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterator

from ..core.db import get_db
from .store import get_persona, list_personas

_DISTILL_SYSTEM_TEMPLATE = (
    "{persona_system_prompt}\n\n"
    "For each input post, decide whether it contains anything relevant to your lens "
    "('{lens}'). If yes, distill the SINGLE most useful insight that fits your lens — "
    "1-3 sentences, written as a generalised lesson (not a quote). Include a short "
    "verbatim excerpt (≤200 chars) that supports the lesson, an importance score "
    "(0..1), and 1-3 tag keywords.\n\n"
    "Return ONLY valid JSON in this exact shape:\n"
    '{{"relevant": <true|false>, "lesson": "<string>", "excerpt": "<string>", '
    '"importance": <0..1>, "tags": ["<tag>", ...]}}\n'
    "If not relevant, return: {{\"relevant\": false}}"
)

_USER_TEMPLATE = (
    "Topic this post was collected under: {topic}\n"
    "Source: {source}\n"
    "Title: {title}\n"
    "Body:\n{body}"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_json_blob(raw: str) -> dict | None:
    """Tolerant JSON parser — strips markdown fences, finds first {...}."""
    if not raw:
        return None
    s = raw.strip()
    # Strip ```json / ``` fences
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    # Try direct
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        pass
    # Fallback: extract first balanced {...}
    start = s.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[start : i + 1])
                except (ValueError, TypeError):
                    return None
    return None


def _candidate_posts(persona_id: int, topic: str | None, limit: int) -> list[dict]:
    """Posts not yet ingested by this persona (any source). Newest first.

    If ``topic`` is given, restricts to posts tagged under that topic in
    ``topic_posts``. Otherwise pulls across all topics.
    """
    db = get_db()
    if topic:
        sql = (
            "SELECT p.id, p.title, p.selftext, p.source_type, p.score, "
            "tp.topic AS topic "
            "FROM posts p "
            "JOIN topic_posts tp ON tp.post_id = p.id "
            "WHERE tp.topic = ? "
            "AND NOT EXISTS (SELECT 1 FROM persona_memories m "
            "                WHERE m.persona_id = ? AND m.source_post_id = p.id) "
            "ORDER BY p.fetched_at DESC "
            "LIMIT ?"
        )
        params = [topic, persona_id, int(limit)]
    else:
        sql = (
            "SELECT p.id, p.title, p.selftext, p.source_type, p.score, "
            "(SELECT topic FROM topic_posts tp WHERE tp.post_id = p.id "
            " ORDER BY ROWID DESC LIMIT 1) AS topic "
            "FROM posts p "
            "WHERE NOT EXISTS (SELECT 1 FROM persona_memories m "
            "                  WHERE m.persona_id = ? AND m.source_post_id = p.id) "
            "ORDER BY p.fetched_at DESC "
            "LIMIT ?"
        )
        params = [persona_id, int(limit)]
    cur = db.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _store_memory(persona_id: int, post: dict, distilled: dict) -> int:
    db = get_db()
    db["persona_memories"].insert({
        "persona_id": persona_id,
        "source_post_id": post.get("id"),
        "topic": post.get("topic") or "",
        "lesson": (distilled.get("lesson") or "").strip()[:1000],
        "excerpt": (distilled.get("excerpt") or "").strip()[:500],
        "tags": json.dumps(distilled.get("tags") or [])[:500],
        "importance": float(distilled.get("importance") or 0.5),
        "created_at": _now(),
    })
    return db.execute("SELECT last_insert_rowid()").fetchone()[0]


def ingest_persona(
    persona_id: int,
    *,
    topic: str | None = None,
    limit: int = 50,
    provider: str | None = None,
) -> Iterator[dict]:
    """Run the persona over candidate posts. Yields progress events.

    Event shapes:
      {"event": "start", "persona_id": id, "candidates": N, "topic": str|None}
      {"event": "skip",  "post_id": pid, "reason": "not_relevant"}
      {"event": "memory","post_id": pid, "memory_id": mid, "lesson": "..."}
      {"event": "error", "post_id": pid, "error": "..."}
      {"event": "done",  "persona_id": id, "kept": K, "dropped": D, "errors": E}
    """
    persona = get_persona(persona_id)
    if not persona:
        yield {"event": "error", "error": f"persona id={persona_id} not found"}
        return
    if not persona.get("active"):
        yield {"event": "error", "error": f"persona '{persona['name']}' is inactive"}
        return

    candidates = _candidate_posts(persona_id, topic, limit)
    yield {
        "event": "start",
        "persona_id": persona_id,
        "persona_name": persona["name"],
        "candidates": len(candidates),
        "topic": topic,
    }

    if not candidates:
        yield {"event": "done", "persona_id": persona_id, "kept": 0, "dropped": 0, "errors": 0}
        return

    # Lazy import — heavy module, only needed when we actually ingest.
    try:
        from ..analyze.providers.base import get_provider
    except Exception as e:
        yield {"event": "error", "error": f"llm provider unavailable: {e}"}
        return

    try:
        prov = get_provider(provider)
    except Exception as e:
        yield {"event": "error", "error": f"no llm configured: {e}"}
        return

    system = _DISTILL_SYSTEM_TEMPLATE.format(
        persona_system_prompt=persona.get("system_prompt") or "",
        lens=persona.get("lens") or "",
    )

    kept = dropped = errors = 0
    for post in candidates:
        body = (post.get("selftext") or "").strip()
        title = (post.get("title") or "").strip()
        if not (body or title):
            dropped += 1
            yield {"event": "skip", "post_id": post.get("id"), "reason": "empty"}
            continue
        # Trim body to keep tokens predictable; 1500 chars is enough signal.
        user_prompt = _USER_TEMPLATE.format(
            topic=post.get("topic") or "(unknown)",
            source=post.get("source_type") or "(unknown)",
            title=title[:200],
            body=body[:1500],
        )
        try:
            raw = prov.complete(
                prompt=user_prompt,
                system=system,
                max_tokens=400,
                temperature=0.2,
            )
        except Exception as e:
            errors += 1
            yield {"event": "error", "post_id": post.get("id"), "error": str(e)[:200]}
            # Back off briefly on rate-limit-flavored errors
            if any(s in str(e).lower() for s in ("rate limit", "429", "overloaded")):
                time.sleep(1.0)
            continue

        parsed = _parse_json_blob(raw or "")
        if not parsed:
            errors += 1
            yield {"event": "error", "post_id": post.get("id"),
                   "error": "llm returned unparseable json", "raw_preview": (raw or "")[:200]}
            continue

        if not parsed.get("relevant") or not (parsed.get("lesson") or "").strip():
            dropped += 1
            yield {"event": "skip", "post_id": post.get("id"), "reason": "not_relevant"}
            continue

        try:
            mid = _store_memory(persona_id, post, parsed)
        except Exception as e:
            errors += 1
            yield {"event": "error", "post_id": post.get("id"), "error": f"persist failed: {e}"}
            continue

        # Phase 2a — embed + build edges. Best-effort: if chromadb isn't
        # available we still kept the memory; the graph just won't grow.
        new_edges = 0
        try:
            from .graph import embed_and_link
            new_edges = embed_and_link(persona_id, mid, (parsed.get("lesson") or "").strip())
        except Exception:
            new_edges = 0

        kept += 1
        yield {
            "event": "memory",
            "post_id": post.get("id"),
            "memory_id": mid,
            "lesson": parsed.get("lesson"),
            "topic": post.get("topic"),
            "importance": parsed.get("importance"),
            "edges_added": new_edges,
        }

    yield {
        "event": "done",
        "persona_id": persona_id,
        "persona_name": persona["name"],
        "kept": kept, "dropped": dropped, "errors": errors,
    }


def ingest_all_personas(
    *, topic: str | None = None, limit: int = 50, provider: str | None = None
) -> Iterator[dict]:
    """Fan out ingest across every active persona. Yields per-persona events."""
    for p in list_personas(active_only=True):
        yield from ingest_persona(p["id"], topic=topic, limit=limit, provider=provider)
