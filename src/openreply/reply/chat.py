"""Agent chat — grounded Q&A over the selected agent's knowledge + data sources.

The chat answers from the agent's full knowledge scope:

* linked persona knowledge (beliefs + memories + graph neighbours) via
  ``build_knowledge_context``;
* collected corpus posts across all watched sources;
* knowledge-graph findings (painpoints, feature wishes, workarounds, products);
* the list of personas and sources that shape the agent's point of view.

It degrades gracefully: an agent with no linked personas and no corpus simply
reports that there is no knowledge yet.
"""

from __future__ import annotations

import json
import re

from .agent import active_id, agent_corpus_topic, get_agent, list_linked_personas
from .knowledge import build_knowledge_context
from .schema import init_reply_schema


def _clean_query(question: str) -> str:
    """Normalize a user question for keyword search: lowercase, drop punctuation,
    collapse whitespace. Keeps words intact so corpus/graph LIKE queries match."""
    s = re.sub(r"[^\w\s]", " ", question.lower())
    return re.sub(r"\s+", " ", s).strip()


def _agent_identity(a: dict) -> str:
    """Compact agent card for the system prompt."""
    parts = [f"Name: {a.get('name') or 'Unnamed'}"]
    if a.get("niche"):
        parts.append(f"Niche: {a['niche']}")
    if a.get("goal"):
        parts.append(f"Goal: {a['goal']}")
    if a.get("product"):
        parts.append(f"Product: {a['product']}")
    if a.get("audience"):
        parts.append(f"Audience: {a['audience']}")
    if a.get("tone"):
        parts.append(f"Tone: {a['tone']}")
    return "\n".join(parts)


def _format_sources(a: dict) -> str:
    platforms = a.get("platforms") or []
    return ", ".join(platforms) if platforms else "none configured"


def _search_words(question: str) -> list[str]:
    """Extract searchable keywords from a cleaned query."""
    return [w for w in question.lower().split() if len(w) > 2]


def _fetch_corpus_rows(agent_id: str, question: str, limit: int = 6) -> list[dict]:
    """Keyword-search the agent's multi-source corpus for the question.

    Splits the query into words and matches any word in title/selftext, so
    natural-language questions work rather than requiring the exact phrase.
    """
    a = get_agent(agent_id)
    if not a:
        return []
    words = _search_words(question)
    if not words:
        return []
    topic = agent_corpus_topic(a)
    db = init_reply_schema()

    word_conds = []
    args: list = [topic]
    for w in words:
        word_conds.append("(lower(p.title) LIKE ? OR lower(p.selftext) LIKE ?)")
        args += [f"%{w}%", f"%{w}%"]

    sql = (
        "SELECT p.id, p.source_type, p.title, p.selftext, p.url, p.permalink "
        "FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        f"WHERE tp.topic = ? AND ({' OR '.join(word_conds)}) "
        "ORDER BY p.score DESC LIMIT ?"
    )
    args.append(limit)

    try:
        rows = list(db.execute(sql, args).fetchall())
    except Exception:
        return []
    return [
        {
            "id": r[0],
            "source": r[1],
            "title": (r[2] or "").strip(),
            "snippet": (r[3] or "")[:320],
            "url": r[4] or r[5] or "",
        }
        for r in rows
    ]


def _fetch_graph_findings(
    agent_id: str, question: str, limit: int = 6
) -> tuple[list[dict], list[dict]]:
    """Return concept nodes matching the question plus their strongest connections."""
    a = get_agent(agent_id)
    if not a:
        return [], []
    words = _search_words(question)
    if not words:
        return [], []
    topic = agent_corpus_topic(a)
    db = init_reply_schema()
    kinds = ("painpoint", "feature_wish", "workaround", "product")
    ph = ",".join(["?"] * len(kinds))

    word_conds = " OR ".join("lower(label) LIKE ?" for _ in words)
    args = [topic, *kinds, *[f"%{w}%" for w in words], limit]

    rows = []
    try:
        rows = list(
            db.execute(
                f"SELECT id, kind, label, metadata_json FROM graph_nodes "
                f"WHERE topic=? AND kind IN ({ph}) AND ({word_conds}) "
                f"ORDER BY length(label) LIMIT ?",
                args,
            ).fetchall()
        )
    except Exception:
        pass

    nodes = [
        {"id": r[0], "kind": r[1], "label": r[2], "meta": json.loads(r[3] or "{}")} for r in rows
    ]

    conns = []
    if nodes:
        ids = [n["id"] for n in nodes]
        id_ph = ",".join(["?"] * len(ids))
        try:
            cr = list(
                db.execute(
                    f"SELECT a.label, e.kind, b.label FROM graph_edges e "
                    f"JOIN graph_nodes a ON a.id=e.src "
                    f"JOIN graph_nodes b ON b.id=e.dst "
                    f"WHERE e.topic=? AND (e.src IN ({id_ph}) OR e.dst IN ({id_ph})) "
                    f"ORDER BY e.weight DESC LIMIT ?",
                    [topic, *ids, *ids, limit],
                ).fetchall()
            )
            conns = [{"from": f, "kind": k, "to": t} for f, k, t in cr]
        except Exception:
            pass
    return nodes, conns


def chat_with_agent(
    question: str,
    agent_id: str | None = None,
    *,
    k_corpus: int = 6,
    k_graph: int = 6,
    provider: str | None = None,
    history: list[dict] | None = None,
) -> dict:
    """Ask the selected agent a question grounded in its knowledge + data sources.

    ``history`` is a list of prior turns ``{"role": "user"|"assistant", "content": ...}``.
    When provided, the last few turns are included in the prompt so follow-up
    questions keep context.

    Returns ``{ok, answer, agent_id, agent_name, citations}``. The answer includes
    citation tags so the user can trace claims back to posts / graph nodes /
    persona memories / beliefs.
    """
    aid = agent_id or active_id()
    a = get_agent(aid)
    if not a:
        return {"ok": False, "error": "no active agent"}

    search_q = _clean_query(question)

    # Core blend: persona beliefs/memories + topic corpus excerpts.
    knowledge_block = build_knowledge_context(a["id"], search_q, corpus_topic=agent_corpus_topic(a))

    # Live corpus rows across all sources.
    corpus_rows = _fetch_corpus_rows(a["id"], search_q, limit=k_corpus)

    # Knowledge-graph findings.
    graph_nodes, graph_conns = _fetch_graph_findings(a["id"], search_q, limit=k_graph)

    # Linked personas that contributed the lens-tagged knowledge.
    linked = list_linked_personas(a["id"])

    if "no knowledge yet" in knowledge_block.lower() and not corpus_rows and not graph_nodes:
        return {
            "ok": True,
            "answer": (
                "I don't have any knowledge yet for this agent. "
                "Run **Refresh + learn** to collect posts, or link a persona with existing memories."
            ),
            "agent_id": a["id"],
            "agent_name": a["name"],
            "citations": {"posts": [], "nodes": []},
        }

    system = (
        f"You are a research assistant for this agent:\n\n{_agent_identity(a)}\n\n"
        f"Sources watched: {_format_sources(a)}\n\n"
        "Answer the user's question using ONLY the provided context. "
        "Cite sources with [P#] for posts, [N#] for graph nodes, [B#] for beliefs, "
        "[M#] for memories. If the context doesn't cover the question, say so honestly "
        "— do NOT invent facts. Keep the answer concise but useful."
    )

    context_parts = [f"KNOWLEDGE BASE:\n{knowledge_block}"]

    if corpus_rows:
        lines = []
        for i, row in enumerate(corpus_rows, 1):
            lines.append(
                f"[P{i}] {row.get('source') or '—'} · {row.get('title') or '—'}\n"
                f"  {row.get('snippet') or ''}"
            )
        context_parts.append("RELEVANT POSTS FROM ALL SOURCES:\n" + "\n\n".join(lines))

    if graph_nodes:
        lines = []
        for i, n in enumerate(graph_nodes, 1):
            meta = n.get("meta") or {}
            evidence = meta.get("evidence_count") or 0
            lines.append(
                f"[N{i}] ({n['kind']}) {n['label']}"
                + (f" — evidence count: {evidence}" if evidence else "")
            )
        if graph_conns:
            lines.append("\nConnections:")
            for c in graph_conns:
                lines.append(f"  • {c['from']} --{c['kind']}--> {c['to']}")
        context_parts.append("RELEVANT GRAPH FINDINGS:\n" + "\n".join(lines))

    if linked:
        context_parts.append(
            "LINKED PERSONAS:\n"
            + "\n".join(f"- {p['name']} ({p['lens']} lens, weight {p['weight']})" for p in linked)
        )

    # Include a short recent history window so follow-ups stay coherent.
    history_block = ""
    if history:
        turns = []
        for h in history[-6:]:
            role = h.get("role") or "user"
            content = (h.get("content") or "").strip()
            if not content:
                continue
            label = "User" if role == "user" else "Assistant"
            turns.append(f"{label}: {content}")
        if turns:
            history_block = "RECENT CONVERSATION:\n" + "\n\n".join(turns) + "\n\n"

    user_prompt = (
        f"{history_block}Question: {question}\n\n"
        + "\n\n".join(context_parts)
        + "\n\nAnswer the question. Cite [P#], [N#], [B#], [M#] where appropriate."
    )

    try:
        from ..analyze.providers.base import get_provider

        prov = get_provider(provider)
        answer = prov.complete(prompt=user_prompt, system=system, max_tokens=900, temperature=0.3)
    except Exception as e:
        return {"ok": False, "error": f"llm call failed: {str(e)[:200]}"}

    return {
        "ok": True,
        "answer": (answer or "").strip(),
        "agent_id": a["id"],
        "agent_name": a["name"],
        "citations": {
            "posts": [{"tag": f"P{i + 1}", **row} for i, row in enumerate(corpus_rows)],
            "nodes": [{"tag": f"N{i + 1}", **n} for i, n in enumerate(graph_nodes)],
        },
    }
