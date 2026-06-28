"""Phase 2b — Conclusion synthesis.

Walks the persona's edge graph, groups memories into connected components
(union-find over edges above a similarity threshold), then asks the LLM
to distill each cluster into one belief written in the persona's voice.
Stores into ``persona_conclusions`` with the supporting memory ids as
JSON evidence trail.

Idempotent: a stable cluster_signature is computed per cluster (sorted
memory-id tuple). If a conclusion with the same signature already exists,
its statement is *refreshed* with the new LLM output rather than
duplicated, so re-running synthesise after new memories land doesn't
spam the conclusions table.

Conservative defaults — small clusters (<3 memories) are skipped to avoid
generating a "conclusion" from a single noisy memory.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Iterator

from ..core.db import get_db
from .store import get_persona

logger = logging.getLogger(__name__)

MIN_CLUSTER_SIZE = 3
MIN_EDGE_FOR_CLUSTER = 0.5  # only edges this strong are used to group
MAX_EVIDENCE_PER_CLUSTER = 8


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _signature(memory_ids: list[int]) -> str:
    return ",".join(str(i) for i in sorted(set(int(x) for x in memory_ids)))


class _UnionFind:
    """Minimal disjoint-set for clustering — no external dep."""

    def __init__(self):
        self.parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        if self.parent.get(x, x) == x:
            self.parent.setdefault(x, x)
            return x
        root = self.find(self.parent[x])
        self.parent[x] = root
        return root

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def _cluster_memories(persona_id: int) -> list[list[int]]:
    """Return clusters of memory_ids based on edges with weight >= threshold."""
    db = get_db()
    cur = db.execute(
        "SELECT from_memory_id, to_memory_id, weight FROM persona_edges "
        "WHERE persona_id = ? AND weight >= ?",
        [persona_id, MIN_EDGE_FOR_CLUSTER],
    )
    uf = _UnionFind()
    nodes: set[int] = set()
    for a, b, _w in cur.fetchall():
        uf.union(int(a), int(b))
        nodes.add(int(a))
        nodes.add(int(b))
    groups: dict[int, list[int]] = {}
    for n in nodes:
        groups.setdefault(uf.find(n), []).append(n)
    return [sorted(g) for g in groups.values() if len(g) >= MIN_CLUSTER_SIZE]


def _fetch_memories(memory_ids: list[int]) -> list[dict]:
    if not memory_ids:
        return []
    db = get_db()
    qmarks = ",".join("?" * len(memory_ids))
    cur = db.execute(
        f"SELECT id, lesson, excerpt, topic, importance "
        f"FROM persona_memories WHERE id IN ({qmarks})",
        memory_ids,
    )
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    rows.sort(key=lambda r: (-(r.get("importance") or 0.0), r["id"]))
    return rows


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


_SYS_TEMPLATE = (
    "{persona_system_prompt}\n\n"
    "You are reviewing a cluster of your own past memories that are "
    "semantically related to each other. Synthesize them into ONE belief "
    "that captures the common pattern — written in your voice, 1-2 sentences, "
    "specific enough to be falsifiable. Also rate your confidence (0..1) "
    "based on how consistent the memories are with each other.\n\n"
    'Return ONLY valid JSON: {{"statement": "<belief>", "confidence": <0..1>}}'
)

_USER_TEMPLATE = (
    "Cluster of {n} related memories (lens='{lens}'):\n\n{evidence}\n\n"
    "Distill the shared belief."
)


def synthesize_conclusions(
    persona_id: int,
    *,
    provider: str | None = None,
    refresh: bool = True,
) -> Iterator[dict]:
    """Generate (or refresh) conclusions for one persona. Yields events.

    Events:
      {"event": "start",    "persona_id", "clusters": N}
      {"event": "skip",     "cluster_signature", "reason"}
      {"event": "concluded","conclusion_id", "statement", "evidence": [ids],
                            "confidence", "refreshed": bool}
      {"event": "error",    "cluster_signature", "error"}
      {"event": "done",     "persona_id", "written": K, "refreshed": R, "skipped": S, "errors": E}
    """
    persona = get_persona(persona_id)
    if not persona:
        yield {"event": "error", "error": f"persona id={persona_id} not found"}
        return

    clusters = _cluster_memories(persona_id)
    yield {"event": "start", "persona_id": persona_id, "clusters": len(clusters)}

    if not clusters:
        yield {"event": "done", "persona_id": persona_id,
               "written": 0, "refreshed": 0, "skipped": 0, "errors": 0}
        return

    try:
        from ..analyze.providers.base import get_provider
        prov = get_provider(provider)
    except Exception as e:
        yield {"event": "error", "error": f"no llm configured: {e}"}
        return

    db = get_db()
    written = refreshed = skipped = errors = 0
    sys_prompt = _SYS_TEMPLATE.format(
        persona_system_prompt=persona.get("system_prompt") or "",
    )

    for cluster in clusters:
        sig = _signature(cluster)
        existing = db.execute(
            "SELECT id, evidence_memory_ids FROM persona_conclusions "
            "WHERE persona_id = ? AND evidence_memory_ids = ?",
            [persona_id, json.dumps(sorted(cluster))],
        ).fetchone()
        if existing and not refresh:
            skipped += 1
            yield {"event": "skip", "cluster_signature": sig, "reason": "already_concluded"}
            continue

        # Pull evidence and cap
        mems = _fetch_memories(cluster)[:MAX_EVIDENCE_PER_CLUSTER]
        if len(mems) < MIN_CLUSTER_SIZE:
            skipped += 1
            yield {"event": "skip", "cluster_signature": sig, "reason": "too_small_after_fetch"}
            continue

        evidence_block = "\n".join(
            f"- (mem#{m['id']}, topic={m.get('topic') or '—'}, importance={m.get('importance') or 0:.2f}): "
            f"{m.get('lesson') or ''}"
            for m in mems
        )
        user_prompt = _USER_TEMPLATE.format(
            n=len(mems), lens=persona.get("lens") or "",
            evidence=evidence_block,
        )

        try:
            raw = prov.complete(prompt=user_prompt, system=sys_prompt,
                                max_tokens=300, temperature=0.3)
        except Exception as e:
            errors += 1
            yield {"event": "error", "cluster_signature": sig,
                   "error": str(e)[:200]}
            continue

        parsed = _parse_json_blob(raw or "")
        if not parsed or not (parsed.get("statement") or "").strip():
            errors += 1
            yield {"event": "error", "cluster_signature": sig,
                   "error": "llm returned unparseable json",
                   "raw_preview": (raw or "")[:200]}
            continue

        statement = (parsed.get("statement") or "").strip()[:1000]
        try:
            confidence = float(parsed.get("confidence") or 0.5)
        except (TypeError, ValueError):
            confidence = 0.5
        evidence_ids_json = json.dumps(sorted(cluster))
        now = _now()
        if existing:
            db.execute(
                "UPDATE persona_conclusions SET statement = ?, confidence = ?, "
                "updated_at = ? WHERE id = ?",
                [statement, confidence, now, existing[0]],
            )
            conclusion_id = existing[0]
            refreshed += 1
            yield {
                "event": "concluded",
                "conclusion_id": conclusion_id,
                "statement": statement,
                "evidence": sorted(cluster),
                "confidence": confidence,
                "refreshed": True,
            }
        else:
            db["persona_conclusions"].insert({
                "persona_id": persona_id,
                "statement": statement,
                "evidence_memory_ids": evidence_ids_json,
                "confidence": confidence,
                "created_at": now,
                "updated_at": now,
            })
            conclusion_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            written += 1
            yield {
                "event": "concluded",
                "conclusion_id": conclusion_id,
                "statement": statement,
                "evidence": sorted(cluster),
                "confidence": confidence,
                "refreshed": False,
            }

    yield {
        "event": "done",
        "persona_id": persona_id,
        "written": written, "refreshed": refreshed,
        "skipped": skipped, "errors": errors,
    }


def list_conclusions(persona_id: int, *, limit: int = 100) -> list[dict]:
    db = get_db()
    cur = db.execute(
        "SELECT id, persona_id, statement, evidence_memory_ids, confidence, "
        "created_at, updated_at FROM persona_conclusions WHERE persona_id = ? "
        "ORDER BY confidence DESC, updated_at DESC LIMIT ?",
        [persona_id, int(limit)],
    )
    cols = [c[0] for c in cur.description]
    out = []
    for r in cur.fetchall():
        d = dict(zip(cols, r))
        try:
            d["evidence"] = json.loads(d.get("evidence_memory_ids") or "[]")
        except (TypeError, ValueError):
            d["evidence"] = []
        out.append(d)
    return out
