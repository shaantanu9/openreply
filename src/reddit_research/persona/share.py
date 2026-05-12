"""Cross-persona memory sharing — Phase 3b.

Take a memory from persona A and re-frame it through persona B's lens,
producing a new persona_memory on B that preserves the source-post
evidence trail. Useful for getting a market-hunter persona to consider
a psychology insight, or pushing a launch-strategy insight onto a
design-focused persona.

The lesson is re-distilled (not copied verbatim) — A might have written
"people are loss-averse" and B's psychology lens would frame the same
underlying post differently than B's market-gap lens would.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from ..core.db import get_db
from .store import get_persona

_RESHARE_SYSTEM = (
    "{persona_system_prompt}\n\n"
    "Another persona just shared one of their memories with you because "
    "it might be relevant to your lens ('{lens}'). Re-frame the underlying "
    "insight THROUGH YOUR OWN LENS — don't just paraphrase the donor's "
    "wording, find what the same evidence says ABOUT YOUR LENS. If it "
    "genuinely doesn't fit your lens, return relevant=false honestly.\n\n"
    "Return ONLY valid JSON: "
    '{{"relevant": <true|false>, "lesson": "<your reframed insight>", '
    '"excerpt": "<short quote from the original post>", '
    '"importance": <0..1>, "tags": ["<tag>", ...]}}\n'
    "If not relevant: {{\"relevant\": false, \"reason\": \"<one-line why>\"}}"
)

_RESHARE_USER = (
    "Donor persona '{donor_name}' (lens='{donor_lens}') wrote this memory:\n\n"
    "  Lesson: {donor_lesson}\n"
    "  Evidence excerpt: \"{donor_excerpt}\"\n"
    "  Original topic: {topic}\n"
    "  Source post id: {post_id}\n\n"
    "If you can find a real insight here for your '{lens}' lens, re-distill it."
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_json_blob(raw: str) -> dict | None:
    if not raw:
        return None
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        pass
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
                    return json.loads(s[start:i + 1])
                except (ValueError, TypeError):
                    return None
    return None


def share_memory(
    from_persona_id: int,
    memory_id: int,
    to_persona_id: int,
    *,
    provider: str | None = None,
) -> dict:
    """Re-frame one memory from A through B's lens. Returns:
        {ok, new_memory_id, lesson, importance}
        or {ok: False, error: ...}
    """
    if from_persona_id == to_persona_id:
        return {"ok": False, "error": "from and to persona must differ"}

    donor = get_persona(from_persona_id)
    receiver = get_persona(to_persona_id)
    if not donor or not receiver:
        return {"ok": False, "error": "persona not found"}
    if not receiver.get("active"):
        return {"ok": False, "error": f"receiver '{receiver['name']}' is inactive"}

    db = get_db()
    cur = db.execute(
        "SELECT id, persona_id, source_post_id, topic, lesson, excerpt, tags, "
        "importance FROM persona_memories WHERE id = ? AND persona_id = ?",
        [memory_id, from_persona_id],
    )
    row = cur.fetchone()
    if not row:
        return {"ok": False, "error": f"memory #{memory_id} not found on donor"}
    cols = [c[0] for c in cur.description]
    src = dict(zip(cols, row))

    # Dedup — if receiver already has a memory from the SAME source post,
    # skip rather than double-up. (Each persona's filter only stores
    # post→memory once; share shouldn't violate that invariant either.)
    if src.get("source_post_id"):
        existing = db.execute(
            "SELECT id, lesson FROM persona_memories "
            "WHERE persona_id = ? AND source_post_id = ?",
            [to_persona_id, src["source_post_id"]],
        ).fetchone()
        if existing:
            return {
                "ok": False,
                "error": "receiver_already_has_memory_from_this_post",
                "existing_memory_id": existing[0],
                "existing_lesson": existing[1],
            }

    try:
        from ..analyze.providers.base import get_provider
        prov = get_provider(provider)
    except Exception as e:
        return {"ok": False, "error": f"no llm configured: {e}"}

    system = _RESHARE_SYSTEM.format(
        persona_system_prompt=receiver.get("system_prompt") or "",
        lens=receiver.get("lens") or "",
    )
    user = _RESHARE_USER.format(
        donor_name=donor["name"],
        donor_lens=donor.get("lens") or "",
        donor_lesson=src.get("lesson") or "",
        donor_excerpt=(src.get("excerpt") or "")[:300],
        topic=src.get("topic") or "(unknown)",
        post_id=src.get("source_post_id") or "(none)",
        lens=receiver.get("lens") or "",
    )

    try:
        raw = prov.complete(prompt=user, system=system, max_tokens=400, temperature=0.3)
    except Exception as e:
        return {"ok": False, "error": f"llm call failed: {str(e)[:200]}"}

    parsed = _parse_json_blob(raw or "")
    if not parsed:
        return {"ok": False, "error": "llm returned unparseable json",
                "raw_preview": (raw or "")[:200]}
    if not parsed.get("relevant") or not (parsed.get("lesson") or "").strip():
        return {
            "ok": False,
            "error": "receiver_lens_says_not_relevant",
            "reason": parsed.get("reason") or "lens mismatch",
        }

    tags_in = parsed.get("tags") or []
    # Decorate with provenance so the UI can show "shared from Psyche".
    tags = list(dict.fromkeys([*tags_in, f"shared_from:{donor['name']}"]))[:8]

    now = _now()
    db["persona_memories"].insert({
        "persona_id": to_persona_id,
        "source_post_id": src.get("source_post_id"),
        "topic": src.get("topic") or "",
        "lesson": (parsed.get("lesson") or "").strip()[:1000],
        "excerpt": (parsed.get("excerpt") or src.get("excerpt") or "").strip()[:500],
        "tags": json.dumps(tags)[:500],
        "importance": float(parsed.get("importance") or 0.5),
        "created_at": now,
    })
    new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

    # Embed + link into the receiver's graph
    new_edges = 0
    try:
        from .graph import embed_and_link
        new_edges = embed_and_link(
            to_persona_id, new_id, (parsed.get("lesson") or "").strip()
        )
    except Exception:
        new_edges = 0

    return {
        "ok": True,
        "new_memory_id": new_id,
        "to_persona_id": to_persona_id,
        "to_persona_name": receiver["name"],
        "from_persona_name": donor["name"],
        "lesson": parsed.get("lesson"),
        "importance": parsed.get("importance"),
        "edges_added": new_edges,
    }
