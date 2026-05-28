"""Community detection — graphify-style Leiden with NetworkX-Louvain fallback.

Why a separate module from `analyze.detect_communities`:
  - analyze.detect_communities returns a transient summary (top members per
    community); it doesn't persist anything.
  - This module persists `community_id` and `community_size` into each node's
    metadata_json so the D3 viewer can color nodes by community without
    re-running clustering on every page load, and so downstream queries
    ("surprising connections" = edges crossing community boundaries) are
    O(graph_edges) instead of O(graph_edges × louvain).

Algorithm choice — copied from graphify/cluster.py:_partition (file:line 1-120):
  1. Try graspologic's Leiden (better modularity, deterministic with seed=42)
  2. Fall back to networkx.community.louvain_communities (always available
     when the `sources` extra is installed)
  3. Exclude top-degree "hub" nodes from cluster assignment by default — a
     single topic/source/sub node connected to everything otherwise drags
     half the graph into one giant community
  4. Split any community larger than `max_fraction` of the graph by
     re-clustering its induced subgraph — prevents the "mega-community"
     anti-pattern when one source dominates

All additive. Existing `analyze.detect_communities` keeps working unchanged.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..core.db import get_db
from .schema import ensure_graph_schema

logger = logging.getLogger(__name__)


# Defaults are tuned for SPARSE social graphs (reddit + ingested docs), NOT
# dense code graphs. The differences vs graphify defaults:
#   resolution 0.5  (graphify uses 1.0) — reddit graphs are sparse so a lower
#       value avoids the ~one-community-per-thread fragmentation you'd get
#       at 1.0. A 5K-node corpus at 1.0 produces ~2700 communities; at 0.5
#       it produces ~15-40.
#   hub_percentile 100 — keep all hubs in the initial pass. In a code graph
#       a single "logger" util touched by everything genuinely needs to be
#       excluded; in a topic graph the source/subreddit/topic hubs ARE the
#       connectors that prevent fragmentation.
#   min_community_size 3 — anything smaller is a 1-post-and-its-author
#       sliver. Persisted with community_id=null so the viewer treats them
#       as "other" rather than colouring 2K singletons.
_DEFAULT_RESOLUTION = 0.5
_DEFAULT_MAX_FRACTION = 0.25
_DEFAULT_MIN_SPLIT_SIZE = 10
_DEFAULT_HUB_PERCENTILE = 100   # 100 = don't exclude any hubs
_DEFAULT_MIN_COMMUNITY_SIZE = 3


def _require_nx():
    try:
        import networkx as nx  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "Install sources extra: pip install -e '.[sources]' "
            "(networkx is required for community detection)"
        ) from e
    return nx


def _try_leiden(G, resolution: float, seed: int = 42) -> list[set] | None:
    """Try graspologic's Leiden first; return None if unavailable so the
    caller falls back to Louvain. Leiden is strictly better than Louvain
    (deterministic with seed, no degenerate splits) but is an optional dep."""
    try:
        from graspologic.partition import leiden  # type: ignore
    except Exception:
        return None
    try:
        # graspologic.leiden returns a flat dict node→community_id.
        assignments = leiden(
            G,
            resolution=resolution,
            random_seed=seed,
        )
        buckets: dict[int, set] = {}
        for node, cid in assignments.items():
            buckets.setdefault(int(cid), set()).add(node)
        return list(buckets.values())
    except Exception as e:
        logger.debug("leiden failed, falling back to louvain: %s", e)
        return None


def _louvain(G, resolution: float, seed: int = 42) -> list[set]:
    nx = _require_nx()
    try:
        from networkx.algorithms.community import louvain_communities
    except ImportError as e:
        raise RuntimeError(
            "networkx >=3.0 required for louvain_communities"
        ) from e
    return list(louvain_communities(G, seed=seed, resolution=resolution))


def _hub_nodes(G, percentile: int) -> set:
    """Return the top-(100 - percentile)% of nodes by degree — the
    "hub" tail we'll exclude from the initial clustering pass."""
    nx = _require_nx()
    if G.number_of_nodes() < 20:
        # Too small to bother trimming — every node matters.
        return set()
    degrees = sorted([d for _, d in G.degree()], reverse=True)
    cutoff_idx = max(1, int(len(degrees) * (100 - percentile) / 100))
    cutoff = degrees[cutoff_idx - 1]
    return {n for n, d in G.degree() if d >= cutoff}


def _split_oversized(
    G,
    communities: list[set],
    max_fraction: float,
    min_split_size: int,
    resolution: float,
    seed: int,
) -> list[set]:
    """Recursively split any community larger than max_fraction of the graph.

    Copied from graphify/cluster.py — without this, a single mega-community
    swallows half the graph when one source/topic dominates connectivity.
    """
    nx = _require_nx()
    total = G.number_of_nodes() or 1
    threshold = max(min_split_size, int(total * max_fraction))
    out: list[set] = []
    for comm in communities:
        if len(comm) <= threshold:
            out.append(comm)
            continue
        # Re-cluster the induced subgraph at higher resolution
        sub = G.subgraph(comm).copy()
        sub_parts = _try_leiden(sub, resolution * 1.5, seed) or _louvain(
            sub, resolution * 1.5, seed
        )
        if len(sub_parts) <= 1:
            # Couldn't split it further — accept as-is.
            out.append(comm)
        else:
            out.extend(sub_parts)
    return out


def _skeleton_node_ids(db, topic: str, max_post_nodes: int = 120) -> set[str]:
    """Pick the same set of nodes the D3 viewer's `skeleton` mode renders.

    Why: the typical topic has 5K+ nodes but the UI only ever shows ~300.
    Clustering all 5K when we'll only colour 300 wastes ~95% of the work
    and produces 100× more "noise" communities the user never sees.
    Matches the SKELETON_KINDS set + connected top-degree posts logic in
    export.export_graph_json.
    """
    from .export import SKELETON_KINDS

    keep: set[str] = set()
    for r in db.query(
        "SELECT id, kind FROM graph_nodes WHERE topic = ?", [topic]
    ):
        if r["kind"] in SKELETON_KINDS:
            keep.add(r["id"])

    # Top-N posts connected to semantic findings — same selection rule the
    # viewer uses to decide which posts to render in skeleton mode.
    evidence_kinds = ("evidenced_by", "wished_in", "about_product",
                      "built_in", "solves", "supports")
    placeholders = ",".join(["?"] * len(evidence_kinds))
    post_scores: dict[str, int] = {}
    for r in db.query(
        f"""SELECT src, dst FROM graph_edges
            WHERE topic = ? AND kind IN ({placeholders})""",
        [topic, *evidence_kinds],
    ):
        for endpoint in (r["src"], r["dst"]):
            if f"{topic}::post::" in endpoint:
                post_scores[endpoint] = post_scores.get(endpoint, 0) + 1
    top_posts = sorted(post_scores.items(), key=lambda p: -p[1])[:max_post_nodes]
    keep.update(pid for pid, _ in top_posts)
    return keep


def detect_communities_leiden(
    topic: str,
    *,
    resolution: float = _DEFAULT_RESOLUTION,
    hub_percentile: int = _DEFAULT_HUB_PERCENTILE,
    max_fraction: float = _DEFAULT_MAX_FRACTION,
    min_split_size: int = _DEFAULT_MIN_SPLIT_SIZE,
    min_community_size: int = _DEFAULT_MIN_COMMUNITY_SIZE,
    skeleton_only: bool = True,
    persist: bool = True,
    seed: int = 42,
) -> dict[str, Any]:
    """Detect communities for a topic, persist community_id into nodes.

    `skeleton_only` (default True) clusters ONLY the nodes the D3 viewer
    actually renders in skeleton mode (~300 nodes vs 5K+). For a 5.6K-node
    topic this drops Louvain time from ~2s to ~50ms and produces the
    handful of communities the UI can actually colour. Pass False to
    cluster every node (useful for downstream analytics that walk the
    full graph).

    Returns a summary dict:
      {topic, algorithm, communities_found, persisted_nodes,
       kind_composition: {cid: {kind: n}}, sizes: [n, ...]}
    """
    nx = _require_nx()
    ensure_graph_schema()
    db = get_db()

    # Decide which subset of nodes to cluster. `keep` is None for full-graph,
    # else the skeleton-only allow-list. Edges where either endpoint is
    # outside `keep` are dropped — they can't pull nodes into a community
    # we never built.
    keep: set[str] | None = (
        _skeleton_node_ids(db, topic) if skeleton_only else None
    )

    # Undirected projection — community structure is direction-independent.
    # Narrow the SQL itself in skeleton mode: instead of pulling 5K nodes
    # to Python-filter down to 300, ask SQLite for just the 300 we want.
    # This was the dominant cost in benchmarks (~80% of wall time).
    G = nx.Graph()
    if keep is None:
        node_iter = db.query(
            "SELECT id, kind, label FROM graph_nodes WHERE topic = ?",
            [topic],
        )
    else:
        if not keep:
            return {
                "topic": topic, "algorithm": None, "communities_found": 0,
                "meaningful_communities": 0, "tiny_communities_dropped": 0,
                "persisted_nodes": 0, "kind_composition": {}, "sizes": [],
                "resolution": resolution, "max_fraction": max_fraction,
                "min_split_size": min_split_size,
                "min_community_size": min_community_size,
                "hub_percentile": hub_percentile, "skeleton_only": True,
                "clustered_node_count": 0,
            }
        # SQLite caps variables at 999 by default; skeleton typically ≤500.
        keep_list = list(keep)
        placeholders = ",".join("?" * len(keep_list))
        node_iter = db.query(
            f"SELECT id, kind, label FROM graph_nodes "
            f"WHERE topic = ? AND id IN ({placeholders})",
            [topic, *keep_list],
        )
    for r in node_iter:
        G.add_node(r["id"], kind=r["kind"], label=r["label"])

    # Edges: same trick — narrow on both endpoints in SQL.
    if keep is None:
        edge_iter = db.query(
            "SELECT src, dst, kind, weight FROM graph_edges WHERE topic = ?",
            [topic],
        )
    else:
        keep_list = list(keep)
        placeholders = ",".join("?" * len(keep_list))
        edge_iter = db.query(
            f"SELECT src, dst, kind, weight FROM graph_edges "
            f"WHERE topic = ? "
            f"  AND src IN ({placeholders}) "
            f"  AND dst IN ({placeholders})",
            [topic, *keep_list, *keep_list],
        )
    for r in edge_iter:
        if r["src"] in G and r["dst"] in G:
            # Sum weights when multiple edges connect the same pair —
            # one richly-evidenced pair pulls them into the same community.
            w = float(r.get("weight") or 1.0)
            if G.has_edge(r["src"], r["dst"]):
                G[r["src"]][r["dst"]]["weight"] += w
            else:
                G.add_edge(r["src"], r["dst"], weight=w)

    if G.number_of_nodes() < 2:
        return {
            "topic": topic,
            "algorithm": None,
            "communities_found": 0,
            "persisted_nodes": 0,
            "kind_composition": {},
            "sizes": [],
        }

    hubs = _hub_nodes(G, hub_percentile)
    core = G.subgraph([n for n in G.nodes if n not in hubs]).copy()

    algo = "leiden"
    communities = _try_leiden(core, resolution, seed)
    if communities is None:
        algo = "louvain"
        communities = _louvain(core, resolution, seed)

    communities = _split_oversized(
        core, communities, max_fraction, min_split_size, resolution, seed
    )

    # Re-attach hubs to their majority-neighbor community so they aren't
    # orphans. Hubs get the community of whichever neighbor-bucket they
    # touch the most — same heuristic graphify uses.
    node_to_cid: dict[str, int] = {}
    for cid, comm in enumerate(sorted(communities, key=len, reverse=True)):
        for n in comm:
            node_to_cid[n] = cid

    for hub in hubs:
        votes: dict[int, int] = {}
        for nb in G.neighbors(hub):
            cid = node_to_cid.get(nb)
            if cid is None:
                continue
            votes[cid] = votes.get(cid, 0) + 1
        if votes:
            node_to_cid[hub] = max(votes.items(), key=lambda kv: kv[1])[0]
        else:
            node_to_cid[hub] = len(communities)  # singleton "orphan" bucket

    # Build summary
    cid_sizes: dict[int, int] = {}
    kind_composition: dict[int, dict[str, int]] = {}
    for node_id, cid in node_to_cid.items():
        cid_sizes[cid] = cid_sizes.get(cid, 0) + 1
        kind = G.nodes[node_id].get("kind") or "unknown"
        kind_composition.setdefault(cid, {})
        kind_composition[cid][kind] = kind_composition[cid].get(kind, 0) + 1

    # Drop communities smaller than min_community_size so the UI doesn't
    # have to colour 2000 singleton "post + its author" pairs. They keep
    # community_size on the node for forensic debugging, but community_id
    # gets set to null so the viewer treats them as "other".
    tiny = {cid for cid, sz in cid_sizes.items() if sz < min_community_size}

    persisted = 0
    if persist:
        # json_patch each node's metadata so we don't clobber existing
        # keys. One UPDATE per node is fine — typical topic has under a
        # few thousand nodes and this runs on demand, not in a hot path.
        for node_id, cid in node_to_cid.items():
            patch: dict[str, Any] = {
                "community_size": int(cid_sizes.get(cid, 0)),
            }
            if cid not in tiny:
                patch["community_id"] = int(cid)
            else:
                # json_patch with `null` removes the key — useful when
                # re-running clustering with stricter thresholds.
                patch["community_id"] = None
            db.conn.execute(
                """UPDATE graph_nodes SET metadata_json = json_patch(
                      coalesce(metadata_json, '{}'),
                      json(:patch)
                   ) WHERE id = :id""",
                {"id": node_id, "patch": json.dumps(patch)},
            )
            persisted += 1
        db.conn.commit()

    meaningful_sizes = sorted(
        [sz for cid, sz in cid_sizes.items() if cid not in tiny], reverse=True
    )
    return {
        "topic": topic,
        "algorithm": algo,
        "communities_found": len(set(node_to_cid.values())),
        "meaningful_communities": len(meaningful_sizes),
        "tiny_communities_dropped": len(tiny),
        "persisted_nodes": persisted,
        "kind_composition": {
            str(k): v for k, v in kind_composition.items() if k not in tiny
        },
        "sizes": meaningful_sizes,
        "resolution": resolution,
        "max_fraction": max_fraction,
        "min_split_size": min_split_size,
        "min_community_size": min_community_size,
        "hub_percentile": hub_percentile,
        "skeleton_only": skeleton_only,
        "clustered_node_count": G.number_of_nodes(),
    }


__all__ = ["detect_communities_leiden"]
