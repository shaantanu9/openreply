"""Unified Brain — merge an Agent's structural graph with its linked personas'
memory graphs + beliefs into ONE connected graph (+ a hierarchical tree).

Two knowledge systems exist separately:
  * structural graph  `graph_nodes`/`graph_edges`  (topic-scoped) — what the niche
    talks about (painpoints/products/users/posts…). Nodes carry `evidence_post_id`.
  * persona brains    `persona_memories`/`persona_edges`/`persona_conclusions`
    (persona-scoped) — distilled lessons → associative edges → clustered beliefs.
    Memories carry `source_post_id`.

This module welds them. Cross-links (persisted in `brain_links`, kept separate so
the topic-shared `graph_edges` is never polluted):
  * grounds   — memory → structural node that share a source post (exact)
  * concludes — belief → its evidence memories
  * about     — memory ↔ structural node by embedding similarity (optional)

Node ids are namespaced to avoid collisions across the three systems:
  g:<node_id>  structural | m:<pid>:<mem_id> memory | b:<pid>:<concl_id> belief
"""
from __future__ import annotations

import json
import time

from .agent import get_agent, list_linked_personas
from .schema import init_reply_schema

_ABOUT_THRESHOLD = 0.42       # cosine for memory↔concept semantic cross-links
_ABOUT_CAP = 4                # max semantic cross-links per memory


def _ensure(db):
    if "brain_links" not in set(db.table_names()):
        db["brain_links"].create(
            {"id": str, "agent_id": str, "src": str, "dst": str,
             "kind": str, "weight": float, "created_at": int},
            pk="id",
        )
        db["brain_links"].create_index(["agent_id"])
    return db


def _rows(db, sql, args=()):
    try:
        return [dict(r) for r in db.execute(sql, args).fetchall()]
    except Exception:
        return []


# sqlite_utils rows come back as tuples from db.execute; use rows_where for dicts.
def _table(db, name, where, args):
    try:
        return [dict(r) for r in db[name].rows_where(where, args)]
    except Exception:
        return []


def _linked(agent):
    try:
        return list_linked_personas(agent["id"]) or []
    except Exception:
        return []


# ── cross-link builder ─────────────────────────────────────────────────────

def relink(agent_id: str | None = None, *, semantic: bool = True) -> dict:
    """(Re)build the cross-links that merge the persona brains into the structural
    graph. Idempotent — clears this agent's links then rebuilds. Returns counts."""
    db = _ensure(init_reply_schema())
    a = get_agent(agent_id)
    if not a:
        return {"error": "no active agent"}
    aid, topic = a["id"], a.get("topic") or a["id"]
    personas = _linked(a)
    pids = [int(p["persona_id"]) for p in personas]

    db["brain_links"].delete_where("agent_id = ?", [aid])
    now = int(time.time())
    out = []
    seen = set()

    def add(src, dst, kind, weight):
        key = (src, dst, kind)
        if key in seen:
            return
        seen.add(key)
        out.append({"id": str(len(out)), "agent_id": aid, "src": src, "dst": dst,
                    "kind": kind, "weight": float(weight), "created_at": now})

    # structural nodes for this topic, indexed by their evidence post
    nodes = _table(db, "graph_nodes", "topic = ?", [topic])
    by_post: dict = {}
    for n in nodes:
        ep = n.get("evidence_post_id")
        if ep:
            by_post.setdefault(ep, []).append(n["id"])

    counts = {"grounds": 0, "concludes": 0, "about": 0}
    mems_all = []
    for pid in pids:
        mems = _table(db, "persona_memories", "persona_id = ?", [pid])
        mems_all.extend((pid, m) for m in mems)
        # grounds: memory → structural node sharing its source post
        for m in mems:
            sp = m.get("source_post_id")
            for gid in by_post.get(sp, []):
                add(f"m:{pid}:{m['id']}", f"g:{gid}", "grounds", 1.0)
                counts["grounds"] += 1
        # concludes: belief → its evidence memories
        for c in _table(db, "persona_conclusions", "persona_id = ?", [pid]):
            try:
                ev = json.loads(c.get("evidence_memory_ids") or "[]")
            except Exception:
                ev = []
            for mid in ev:
                add(f"b:{pid}:{c['id']}", f"m:{pid}:{mid}", "concludes", c.get("confidence") or 0.5)
                counts["concludes"] += 1

    # about: semantic memory↔concept links via the shared MiniLM embedder
    if semantic and mems_all and nodes:
        try:
            counts["about"] = _semantic_links(mems_all, nodes, add)
        except Exception:
            pass  # embedder unavailable → exact links still applied

    if out:
        db["brain_links"].insert_all(out, pk="id")
    return {"agent": a["name"], "links": len(out), **counts}


def _cos(a, b):
    s = na = nb = 0.0
    for x, y in zip(a, b):
        s += x * y; na += x * x; nb += y * y
    return s / ((na ** 0.5) * (nb ** 0.5) + 1e-9)


def _semantic_links(mems_all, nodes, add) -> int:
    """Embed memory lessons + concept labels (semantic nodes only) and connect by
    cosine. Best-effort; raises if the embedder isn't available (caller skips)."""
    from ..retrieval.embedder import get_embedding_function
    ef = get_embedding_function()
    concept_kinds = {"painpoint", "feature_wish", "workaround", "product"}
    concepts = [n for n in nodes if (n.get("kind") in concept_kinds) and (n.get("label"))]
    if not concepts:
        return 0
    mem_texts = [(m.get("lesson") or "")[:400] for _, m in mems_all]
    con_texts = [(n.get("label") or "")[:200] for n in concepts]
    mv = ef(mem_texts)
    cv = ef(con_texts)
    n_about = 0
    for i, (pid, m) in enumerate(mems_all):
        scored = sorted(
            ((_cos(mv[i], cv[j]), j) for j in range(len(concepts))),
            reverse=True,
        )[:_ABOUT_CAP]
        for score, j in scored:
            if score >= _ABOUT_THRESHOLD:
                add(f"m:{pid}:{m['id']}", f"g:{concepts[j]['id']}", "about", round(float(score), 3))
                n_about += 1
    return n_about


# ── unified read model (graph + tree) ──────────────────────────────────────

_GROUP_OF_KIND = {  # structural node kind → display group
    "painpoint": "painpoint", "feature_wish": "wish", "workaround": "workaround",
    "product": "product", "user": "user", "author": "user",
    "source": "source", "subreddit": "source", "post": "post", "comment": "post",
    "topic": "topic", "era": "topic",
}

# The "cognitive" layer — the concepts a brain actually reasons over. Raw substrate
# (individual posts/users/comments/sources) is evidence, reachable by clicking a
# memory, so it's excluded from the graph by default to keep it legible.
_CONCEPT_KINDS = {"painpoint", "feature_wish", "workaround", "product", "topic", "era"}


def unified_brain(agent_id: str | None = None, *, node_cap: int = 400,
                  include_substrate: bool = False) -> dict:
    """Merged {graph:{nodes,edges}, tree, stats} for the agent + its personas."""
    db = _ensure(init_reply_schema())
    a = get_agent(agent_id)
    if not a:
        return {"error": "no active agent — create one first"}
    aid, topic = a["id"], a.get("topic") or a["id"]
    personas = _linked(a)
    lens_of = {int(p["persona_id"]): (p.get("lens") or p.get("name") or f"p{p['persona_id']}") for p in personas}
    pids = list(lens_of)

    nodes, edges, keep = [], [], set()

    # structural nodes — keep the concept layer (painpoints/products/…) by default;
    # raw posts/users/sources are substrate (evidence), opt-in via include_substrate.
    gnodes = _table(db, "graph_nodes", "topic = ?", [topic])
    if not include_substrate:
        gnodes = [n for n in gnodes if n.get("kind") in _CONCEPT_KINDS]
    gnodes = gnodes[:node_cap]
    for n in gnodes:
        nid = f"g:{n['id']}"; keep.add(nid)
        nodes.append({"id": nid, "label": (n.get("label") or n["id"])[:80],
                      "group": _GROUP_OF_KIND.get(n.get("kind"), "concept"),
                      "kind": n.get("kind"), "post": n.get("evidence_post_id")})
    for e in _table(db, "graph_edges", "topic = ?", [topic]):
        s, d = f"g:{e['src']}", f"g:{e['dst']}"
        if s in keep and d in keep:
            edges.append({"src": s, "dst": d, "kind": e.get("kind") or "relates_to", "weight": e.get("weight") or 0.5})

    # persona memories + beliefs + their edges
    tree_personas = []
    for pid in pids:
        lens = lens_of[pid]
        mems = _table(db, "persona_memories", "persona_id = ?", [pid])
        for m in mems:
            nid = f"m:{pid}:{m['id']}"; keep.add(nid)
            nodes.append({"id": nid, "label": (m.get("lesson") or "")[:80], "group": "memory",
                          "lens": lens, "importance": m.get("importance") or 0.0,
                          "excerpt": (m.get("excerpt") or "")[:200], "post": m.get("source_post_id")})
        for e in _table(db, "persona_edges", "persona_id = ?", [pid]):
            s, d = f"m:{pid}:{e['from_memory_id']}", f"m:{pid}:{e['to_memory_id']}"
            if s in keep and d in keep:
                edges.append({"src": s, "dst": d, "kind": e.get("kind") or "relates_to", "weight": e.get("weight") or 0.5})
        concls = _table(db, "persona_conclusions", "persona_id = ?", [pid])
        belief_tree = []
        for c in concls:
            nid = f"b:{pid}:{c['id']}"; keep.add(nid)
            nodes.append({"id": nid, "label": (c.get("statement") or "")[:90], "group": "belief",
                          "lens": lens, "confidence": c.get("confidence") or 0.0})
            try:
                ev = json.loads(c.get("evidence_memory_ids") or "[]")
            except Exception:
                ev = []
            belief_tree.append({"id": nid, "statement": c.get("statement") or "",
                                "confidence": c.get("confidence") or 0.0, "evidence": len(ev)})
        tree_personas.append({"persona_id": pid, "lens": lens,
                              "memories": len(mems), "beliefs": len(concls),
                              "top_beliefs": sorted(belief_tree, key=lambda b: b["confidence"], reverse=True)[:8]})

    # cross-links (the merge)
    for l in _table(db, "brain_links", "agent_id = ?", [aid]):
        if l["src"] in keep and l["dst"] in keep:
            edges.append({"src": l["src"], "dst": l["dst"], "kind": l.get("kind") or "about", "weight": l.get("weight") or 0.5})

    # stats by group
    by_group: dict = {}
    for n in nodes:
        by_group[n["group"]] = by_group.get(n["group"], 0) + 1
    cross = sum(1 for e in edges if e["kind"] in ("grounds", "concludes", "about"))

    # tree: structural concept branch (top painpoints/products by degree)
    deg: dict = {}
    for e in edges:
        deg[e["src"]] = deg.get(e["src"], 0) + 1
        deg[e["dst"]] = deg.get(e["dst"], 0) + 1
    concept_nodes = [n for n in nodes if n["group"] in ("painpoint", "product", "wish", "workaround")]
    concept_nodes.sort(key=lambda n: deg.get(n["id"], 0), reverse=True)
    structural_tree = [{"label": n["label"], "kind": n.get("kind"), "degree": deg.get(n["id"], 0)} for n in concept_nodes[:12]]

    return {
        "agent": {"id": aid, "name": a.get("name"), "topic": topic},
        "graph": {"nodes": nodes, "edges": edges},
        "tree": {"personas": tree_personas, "structural": structural_tree},
        "stats": {"nodes": len(nodes), "edges": len(edges), "cross_links": cross,
                  "by_group": by_group, "personas": len(pids)},
    }
