"""Reply knowledge blend — fuse a product Agent's linked Personas' own
knowledge (beliefs + memories + semantic-graph neighbors) with the shared
topic corpus into one prompt-ready context block.

This is what turns a reply from "quotes a relevant post" into "writes from a
formed point of view": the persona's synthesised *conclusions* (its beliefs)
lead, followed by the most relevant *memories* and their *graph neighbors*
(the "related knowledge"), then a few raw corpus excerpts for freshness.

Degrades gracefully: an agent with no linked personas yields empty
beliefs/memories, so the block is just corpus excerpts — byte-for-byte the
pre-blend behaviour, no regression for un-linked agents.

Retrieval is query-seeded: pass the opportunity post text (for `reply draft`)
or the angle/keywords (for standalone content). A blank query falls back to
the persona's highest-importance memories.
"""
from __future__ import annotations

from .agent import list_linked_personas
from .schema import init_reply_schema


def _corpus_excerpts(topic: str | None, limit: int = 4) -> str:
    """Top posts (by score) for the agent's shared topic corpus."""
    if not topic:
        return ""
    db = init_reply_schema()
    try:
        rows = db.execute(
            "SELECT p.title, p.selftext FROM posts p "
            "JOIN topic_posts tp ON p.id = tp.post_id "
            "WHERE tp.topic = ? ORDER BY p.score DESC LIMIT ?",
            [topic, limit],
        ).fetchall()
    except Exception:
        rows = []
    return "\n".join(f"- {t}: {(b or '')[:200]}" for t, b in rows)


def proportional_alloc(links: list[tuple], k: int) -> list[tuple]:
    """Split ``k`` memory slots across linked personas by weight.

    ``links`` is ``[(persona_id, weight), ...]``. Each linked persona gets at
    least 1 slot when ``k >= n``; when ``k < n`` only the top-``k`` personas by
    weight get a slot. The returned slots sum to ``min(k, total demand)``.
    """
    n = len(links)
    if n == 0 or k <= 0:
        return []
    if k <= n:
        ranked = sorted(enumerate(links), key=lambda iw: -float(iw[1][1] or 0))
        keep = {i for i, _ in ranked[:k]}
        return [(lid, 1 if i in keep else 0) for i, (lid, _) in enumerate(links)]
    weights = [max(0.0, float(w or 0)) for _, w in links]
    if sum(weights) <= 0:
        weights = [1.0] * n
    total = sum(weights)
    rem = k - n  # everyone starts at 1, distribute the rest
    raw = [w / total * rem for w in weights]
    alloc = [1 + int(x) for x in raw]
    short = k - sum(alloc)
    # hand out leftover slots to the largest fractional remainders
    fracs = sorted(range(n), key=lambda i: -(raw[i] - int(raw[i])))
    for j in range(short):
        alloc[fracs[j % n]] += 1
    return [(links[i][0], alloc[i]) for i in range(n)]


def retrieve_for_agent(
    agent_id: str, query: str, *, k_mem: int = 6, neighbor_cap: int = 4
) -> list[dict]:
    """Pull ``k_mem`` memories across an agent's linked personas (weighted),
    each expanded with up to ``neighbor_cap`` graph neighbors. Every row is
    tagged with ``_persona``/``_lens`` provenance and ``_neighbor`` for graph
    hops. Returns [] when the agent has no linked personas."""
    from ..persona import graph as _graph
    from ..persona.retrieve import retrieve as _retrieve

    links = list_linked_personas(agent_id)
    if not links:
        return []
    by_pid = {ln["persona_id"]: ln for ln in links}
    alloc = proportional_alloc([(ln["persona_id"], ln["weight"]) for ln in links], k_mem)
    seen: set[int] = set()
    out: list[dict] = []
    for pid, n in alloc:
        if n <= 0:
            continue
        meta = by_pid[pid]
        try:
            mems, _kind = _retrieve(pid, query or "", n)
        except Exception:
            mems = []
        picked: list[dict] = []
        for m in mems:
            mid = int(m["id"])
            if mid in seen:
                continue
            seen.add(mid)
            m["_persona"], m["_lens"], m["_neighbor"] = meta["name"], meta["lens"], False
            picked.append(m)
        try:
            neigh = _graph.neighbors(pid, [int(m["id"]) for m in picked], limit=neighbor_cap)
        except Exception:
            neigh = []
        for m in neigh:
            mid = int(m["id"])
            if mid in seen:
                continue
            seen.add(mid)
            m["_persona"], m["_lens"], m["_neighbor"] = meta["name"], meta["lens"], True
            picked.append(m)
        out.extend(picked)
    return out


def agent_beliefs(agent_id: str, *, limit: int = 3) -> list[dict]:
    """Top conclusions (the personas' synthesised beliefs) across all linked
    personas, highest-confidence first, lens-tagged."""
    try:
        from ..persona.conclude import list_conclusions
    except Exception:
        return []
    out: list[dict] = []
    for ln in list_linked_personas(agent_id):
        try:
            for c in list_conclusions(ln["persona_id"], limit=limit):
                c["_persona"], c["_lens"] = ln["name"], ln["lens"]
                out.append(c)
        except Exception:
            continue
    out.sort(key=lambda c: -(c.get("confidence") or 0.0))
    return out[:limit]


def _lens_tag(row: dict) -> str:
    lens = (row.get("_lens") or "").strip()
    rel = " · related" if row.get("_neighbor") else ""
    return f"[{lens} lens{rel}] " if lens else ("[related] " if row.get("_neighbor") else "")


def build_knowledge_context(
    agent_id: str,
    query: str,
    *,
    corpus_topic: str | None = None,
    corpus_limit: int = 4,
    k_mem: int = 6,
) -> str:
    """Assemble the full knowledge block fed to the reply/content LLM:
    beliefs → retrieved memories (+graph neighbors) → corpus excerpts."""
    beliefs = agent_beliefs(agent_id, limit=3)
    memories = retrieve_for_agent(agent_id, query, k_mem=k_mem)
    corpus = _corpus_excerpts(corpus_topic, corpus_limit)

    blocks: list[str] = []
    if beliefs:
        lines = [
            f"- {_lens_tag(c)}{(c.get('statement') or '').strip()} "
            f"(confidence {float(c.get('confidence') or 0):.2f})"
            for c in beliefs
        ]
        blocks.append("Your established beliefs (your formed point of view):\n" + "\n".join(lines))
    if memories:
        lines = []
        for m in memories:
            ev = (m.get("excerpt") or "").strip()
            ev = f" — evidence: {ev[:160]}" if ev else ""
            lines.append(f"- {_lens_tag(m)}{(m.get('lesson') or '').strip()}{ev}")
        blocks.append("Related knowledge from your memory (most relevant first):\n" + "\n".join(lines))
    if corpus:
        blocks.append("Recent niche conversations (live corpus):\n" + corpus)

    if not blocks:
        return "(no knowledge yet — link a persona with `openreply agent link-persona`, or run `openreply agent refresh`)"
    return "\n\n".join(blocks)
