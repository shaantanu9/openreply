"""Graph analysis via NetworkX — PageRank, community detection, centrality.

Surfaces structural insights the eye misses:
  - "hidden hub" nodes with high PageRank but low visible degree
  - community clusters (Louvain)
  - betweenness bridges (nodes connecting otherwise-separate clusters)

Requires networkx (pip install -e '.[sources]' — bundled in sources extra).
"""
from __future__ import annotations

from typing import Any

from ..core.db import get_db


def _require_nx():
    try:
        import networkx as nx  # type: ignore
    except ImportError as e:
        raise RuntimeError("Install sources extra: pip install -e '.[sources]'") from e
    return nx


def build_nx(topic: str) -> Any:
    """Build a NetworkX graph from the SQLite graph_* tables for a topic."""
    nx = _require_nx()
    db = get_db()
    G = nx.DiGraph()
    for r in db.query("SELECT * FROM graph_nodes WHERE topic = ?", [topic]):
        G.add_node(r["id"], kind=r["kind"], label=r["label"])
    for r in db.query("SELECT * FROM graph_edges WHERE topic = ?", [topic]):
        if r["src"] in G and r["dst"] in G:
            G.add_edge(r["src"], r["dst"], kind=r["kind"], weight=r.get("weight") or 1.0)
    return G


def pagerank_nodes(
    topic: str, top_n: int = 20, kind: str | None = None
) -> list[dict]:
    """Rank nodes by PageRank. Optionally filter to one kind (e.g. 'painpoint')."""
    nx = _require_nx()
    G = build_nx(topic)
    if G.number_of_nodes() == 0:
        return []
    pr = nx.pagerank(G, alpha=0.85, max_iter=200)
    items = []
    for node_id, score in pr.items():
        data = G.nodes[node_id]
        if kind and data.get("kind") != kind:
            continue
        items.append({
            "id": node_id, "kind": data.get("kind"), "label": data.get("label"),
            "pagerank": round(score, 6),
            "in_degree": G.in_degree(node_id),
            "out_degree": G.out_degree(node_id),
        })
    items.sort(key=lambda x: x["pagerank"], reverse=True)
    return items[:top_n]


def detect_communities(topic: str, max_communities: int = 10) -> list[dict]:
    """Louvain community detection on the undirected projection.

    Returns N communities with their top (by degree) nodes.
    """
    nx = _require_nx()
    try:
        from networkx.algorithms.community import louvain_communities
    except ImportError:
        return [{"_error": "networkx >=3.0 required for louvain_communities"}]
    G = build_nx(topic).to_undirected()
    if G.number_of_nodes() == 0:
        return []
    communities = louvain_communities(G, seed=42)
    out = []
    for i, comm in enumerate(sorted(communities, key=len, reverse=True)[:max_communities]):
        nodes = list(comm)
        # Rank the community's members by degree within the whole graph
        ranked = sorted(nodes, key=lambda n: G.degree(n), reverse=True)
        top_members = [
            {"id": n, "kind": G.nodes[n].get("kind"), "label": G.nodes[n].get("label")}
            for n in ranked[:10]
        ]
        kinds = {}
        for n in nodes:
            k = G.nodes[n].get("kind")
            kinds[k] = kinds.get(k, 0) + 1
        out.append({
            "community_id": i,
            "size": len(nodes),
            "kind_counts": kinds,
            "top_members": top_members,
        })
    return out


def betweenness_bridges(topic: str, top_n: int = 15) -> list[dict]:
    """Top nodes by betweenness centrality — structural bridges."""
    nx = _require_nx()
    G = build_nx(topic)
    if G.number_of_nodes() == 0:
        return []
    # Use k-sample approximation for large graphs
    k = min(200, G.number_of_nodes())
    bc = nx.betweenness_centrality(G, k=k, seed=42)
    items = [
        {
            "id": nid, "kind": G.nodes[nid].get("kind"),
            "label": G.nodes[nid].get("label"),
            "betweenness": round(b, 6),
        }
        for nid, b in bc.items()
    ]
    items.sort(key=lambda x: x["betweenness"], reverse=True)
    return items[:top_n]


def graph_summary(topic: str) -> dict:
    """High-level structural summary — useful for dashboards."""
    nx = _require_nx()
    G = build_nx(topic)
    if G.number_of_nodes() == 0:
        return {"topic": topic, "error": "empty graph"}
    try:
        density = nx.density(G)
    except Exception:
        density = None
    return {
        "topic": topic,
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "density": round(density, 6) if density is not None else None,
        "is_dag": nx.is_directed_acyclic_graph(G),
        "components_weak": nx.number_weakly_connected_components(G),
    }
