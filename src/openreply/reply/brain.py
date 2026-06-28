"""Agent brain — the knowledge graph of an agent's content and connections.

OpenReply agents already get a *semantic memory* brain for free: every learning
pass distills posts into persona memories that are embedded into the ChromaDB
"Palace" (memplace) and linked by cosine similarity into `persona_edges`
(see ``persona.graph.embed_and_link``). That powers retrieval in replies/content.

What was missing is the **topic knowledge graph** over the agent's *collected
content* — the `graph_nodes` / `graph_edges` of posts, authors, subreddits,
comments and (when enriched) the niche's painpoints / feature wishes /
workarounds, all connected structurally and by embedding similarity. The
machinery exists in ``openreply.graph`` but was never invoked from the agent path,
so the agent's Knowledge page showed `graph_nodes = 0`.

This module wires the canonical graph build (the same chain
``cli.main.cmd_repair_topic_graph`` uses) to an agent:

    build_structural(topic)             # content nodes + structural edges (no LLM)
    enrich_from_llm(topic, provider)    # painpoints/wishes/workarounds (LLM, deep only)
    build_semantic_relations(topic)     # cosine "connections" between findings (embeddings)
    backfill_source_evidence(topic)     # link findings back to their source posts

Every step is best-effort: a failure in one is captured and the rest still run,
so a graph hiccup never breaks learning/refresh. Reuses the shared embedder
(MiniLM ONNX, same as the Palace) for the semantic relations — no new model.
"""
from __future__ import annotations

from . import agent as _agent


def build_brain_for_agent(
    agent_id: str | None = None,
    *,
    deep: bool = False,
    provider: str | None = None,
    progress=None,
) -> dict:
    """Build (or rebuild) the knowledge graph over an agent's collected content.

    ``deep=False`` (default, cheap, no LLM): structural content graph +
    embedding-similarity relations between any existing findings — safe to run
    after every learn/refresh.

    ``deep=True``: also runs the LLM extraction (``enrich_from_llm``) that mines
    painpoints / feature wishes / product complaints / workarounds from the
    corpus, so the semantic-relations pass has rich nodes to connect. Costs LLM
    calls; gated behind the explicit "Build brain" action.

    Returns a status dict with per-step results + the refreshed knowledge counts.
    Never raises.
    """
    a = _agent.get_agent(agent_id)
    if not a:
        return {"error": "no such agent"}
    topic = a.get("topic") or a.get("name")
    if not topic:
        return {"agent": a.get("name"), "error": "agent has no topic to build a graph for"}

    out: dict = {"agent": a["name"], "topic": topic, "deep": deep}

    # 1) Structural content graph — posts/authors/subreddits/comments + edges.
    #    Reads the already-collected topic_posts/posts/comments; zero LLM cost.
    try:
        if progress:
            progress("building content graph…")
        from ..graph import build_structural
        out["structural"] = build_structural(topic)
    except Exception as e:
        out["structural_error"] = str(e)[:200]

    # 2) (deep) LLM-extract the niche's painpoints / feature wishes / workarounds
    #    as semantic graph nodes. Best-effort + provider auto-resolved.
    if deep:
        try:
            if progress:
                progress("mining niche insights (LLM)…")
            from ..graph import enrich_from_llm
            out["semantic"] = enrich_from_llm(topic=topic, provider=provider)
        except Exception as e:
            out["semantic_error"] = str(e)[:200]

    # 3) Embedding-similarity connections between findings (relates_to /
    #    potentially_solves / could_address / co_evidenced). Uses the shared
    #    MiniLM embedder — the same model behind the Palace.
    try:
        if progress:
            progress("linking related insights (embeddings)…")
        from ..graph.relations import build_semantic_relations
        out["relations"] = build_semantic_relations(topic)
    except Exception as e:
        out["relations_error"] = str(e)[:200]

    # 4) Backfill source evidence so each finding links back to its posts.
    try:
        from ..graph.semantic import backfill_source_evidence
        out["source_evidence"] = backfill_source_evidence(topic)
    except Exception as e:
        out["source_evidence_error"] = str(e)[:200]

    # Refreshed counts for the UI (graph_nodes / findings now populated).
    try:
        out["graph"] = _agent.knowledge_summary(a["id"])
    except Exception:
        pass

    g = out.get("graph") or {}
    nodes = g.get("graph_nodes", 0)
    findings = g.get("findings", 0)
    out["message"] = (
        f"Brain built — {nodes} graph node(s), {findings} insight(s)."
        if nodes else
        "Built the content graph (no nodes yet — collect/learn first so there's content to map)."
    )
    return out


def graph_overview(agent_id: str | None = None, *, limit: int = 40) -> dict:
    """A compact view of the agent's knowledge graph for the UI: counts by node
    kind, the top connected nodes, and a sample of the strongest connections.
    Read-only; never raises."""
    a = _agent.get_agent(agent_id)
    if not a:
        return {"error": "no such agent"}
    topic = a.get("topic") or a.get("name")
    try:
        from ..graph.schema import get_db
        db = get_db()
    except Exception as e:
        return {"agent": a["name"], "topic": topic, "error": str(e)[:200]}

    def _rows(sql, args):
        try:
            return list(db.execute(sql, args).fetchall())
        except Exception:
            return []

    kinds = _rows(
        "SELECT kind, COUNT(*) FROM graph_nodes WHERE topic=? GROUP BY kind ORDER BY 2 DESC",
        [topic],
    )
    total_nodes = sum(c for _, c in kinds)
    total_edges = (_rows("SELECT COUNT(*) FROM graph_edges WHERE topic=?", [topic]) or [[0]])[0][0]

    # Top nodes by degree (most connected = the niche's hubs).
    top = _rows(
        """SELECT n.label, n.kind, COUNT(e.src) AS deg
           FROM graph_nodes n
           JOIN graph_edges e ON (e.src = n.id OR e.dst = n.id) AND e.topic = n.topic
           WHERE n.topic = ?
           GROUP BY n.id ORDER BY deg DESC LIMIT ?""",
        [topic, limit],
    )
    # A sample of the strongest semantic connections (relates_to / solves / addresses).
    conns = _rows(
        """SELECT a.label, e.kind, b.label, e.weight
           FROM graph_edges e
           JOIN graph_nodes a ON a.id = e.src
           JOIN graph_nodes b ON b.id = e.dst
           WHERE e.topic = ? AND e.kind IN
             ('relates_to','potentially_solves','could_address','co_evidenced')
           ORDER BY e.weight DESC LIMIT ?""",
        [topic, limit],
    )
    return {
        "agent": a["name"], "topic": topic,
        "total_nodes": total_nodes, "total_edges": total_edges,
        "by_kind": [{"kind": k, "count": c} for k, c in kinds],
        "hubs": [{"label": l, "kind": k, "degree": d} for l, k, d in top],
        "connections": [
            {"from": f, "kind": k, "to": t, "weight": round(float(w or 0), 3)}
            for f, k, t, w in conns
        ],
    }
