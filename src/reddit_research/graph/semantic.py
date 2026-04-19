"""Semantic enrichment — persists LLM-extracted painpoints / feature wishes /
product complaints / DIY workarounds as graph nodes + edges.

Two entry points:
  - enrich_from_llm(topic, provider):  runs find_gaps() (CLI path, needs LLM key)
  - upsert_semantic(topic, ...):       accepts pre-extracted payloads (MCP path,
                                       Claude is the LLM and passes structured
                                       data in)
"""
from __future__ import annotations

import re
from typing import Any, Iterable

from ..core.db import get_db
from ..research.gaps import find_gaps
from .build import _upsert_edge, _upsert_node
from .schema import ensure_graph_schema, make_node_id


def _slug(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (label or "").lower()).strip("-")
    return s[:60] or "unnamed"


def _link_evidence(db, topic: str, sem_node: str, post_ids: Iterable[str], kind: str) -> int:
    """Create evidence edges from semantic node to posts (if posts exist)."""
    n = 0
    for pid in post_ids or []:
        if not pid:
            continue
        post_node = make_node_id(topic, "post", pid)
        # Only link if the post exists in the graph (was collected)
        if db["graph_nodes"].count_where("id = ?", [post_node]) == 0:
            continue
        _upsert_edge(db, topic, sem_node, post_node, kind)
        n += 1
    return n


def upsert_semantic(
    topic: str,
    painpoints: list[dict[str, Any]] | None = None,
    feature_wishes: list[dict[str, Any]] | None = None,
    product_complaints: list[dict[str, Any]] | None = None,
    diy_workarounds: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Persist pre-extracted gap signals as graph nodes + edges.

    This is the "Claude-as-LLM" path: Claude Code synthesizes from the corpus
    and calls this to persist the results. Schemas match prompts/*.yaml.
    """
    ensure_graph_schema()
    db = get_db()
    topic_node = make_node_id(topic, "topic", topic)
    # Ensure topic node exists so edges are valid
    if db["graph_nodes"].count_where("id = ?", [topic_node]) == 0:
        _upsert_node(db, topic, "topic", topic, topic)

    # Collapse near-duplicates before persisting — two painpoints that mean
    # the same thing should be one node with aliases, not two separate cards.
    # Clustering is best-effort (passthrough if chromadb isn't installed).
    try:
        from ..retrieval.cluster import cluster_findings
        clustered = cluster_findings({
            "painpoints": painpoints or [],
            "feature_wishes": feature_wishes or [],
            "product_complaints": product_complaints or [],
            "diy_workarounds": diy_workarounds or [],
        })
        painpoints = clustered.get("painpoints") or painpoints
        feature_wishes = clustered.get("feature_wishes") or feature_wishes
        product_complaints = clustered.get("product_complaints") or product_complaints
        diy_workarounds = clustered.get("diy_workarounds") or diy_workarounds
    except Exception:
        pass  # clustering is best-effort; never block enrich

    summary = {
        "painpoints_added": 0,
        "feature_wishes_added": 0,
        "products_added": 0,
        "workarounds_added": 0,
        "evidence_edges": 0,
    }

    for pp in painpoints or []:
        title = pp.get("painpoint") or pp.get("title") or ""
        if not title:
            continue
        node = _upsert_node(
            db, topic, "painpoint", _slug(title), title,
            metadata={
                "severity": pp.get("severity"),
                "frequency": pp.get("frequency"),
                "evidence": pp.get("evidence"),
                "classification": pp.get("classification"),  # CHRONIC/EMERGING/FADING
                "pre_2025_freq": pp.get("pre_2025_freq"),
                "post_2025_freq": pp.get("post_2025_freq"),
                "aliases": pp.get("aliases"),
            },
        )
        _upsert_edge(db, topic, topic_node, node, "has_painpoint")
        summary["painpoints_added"] += 1
        summary["evidence_edges"] += _link_evidence(
            db, topic, node, pp.get("example_post_ids") or pp.get("example_ids") or [],
            "evidenced_by",
        )

    for fw in feature_wishes or []:
        title = fw.get("feature") or fw.get("title") or ""
        if not title:
            continue
        node = _upsert_node(
            db, topic, "feature_wish", _slug(title), title,
            metadata={
                "user_quote": fw.get("user_quote"),
                "frequency": fw.get("frequency"),
                "aliases": fw.get("aliases"),
            },
        )
        _upsert_edge(db, topic, topic_node, node, "has_feature_wish")
        summary["feature_wishes_added"] += 1
        summary["evidence_edges"] += _link_evidence(
            db, topic, node, fw.get("example_post_ids") or [], "wished_in",
        )

    for pc in product_complaints or []:
        prod = pc.get("product")
        complaint = pc.get("complaint")
        if not prod:
            continue
        prod_node = _upsert_node(
            db, topic, "product", _slug(prod), prod,
            metadata={"severity": pc.get("severity"), "frequency": pc.get("frequency")},
        )
        _upsert_edge(db, topic, topic_node, prod_node, "has_product")
        summary["products_added"] += 1
        # Complaint edges need a complaint/painpoint anchor. Use a synthetic
        # painpoint keyed by product+issue so repeated complaints aggregate.
        if complaint:
            pp_node = _upsert_node(
                db, topic, "painpoint", _slug(f"{prod}-{complaint}"),
                f"{prod}: {complaint}",
                metadata={
                    "about_product": prod,
                    "severity": pc.get("severity"),
                    "frequency": pc.get("frequency"),
                },
            )
            _upsert_edge(db, topic, topic_node, pp_node, "has_painpoint")
            _upsert_edge(db, topic, pp_node, prod_node, "about_product")
            summary["painpoints_added"] += 1
            summary["evidence_edges"] += _link_evidence(
                db, topic, pp_node, pc.get("example_post_ids") or [], "evidenced_by",
            )

    for wa in diy_workarounds or []:
        desc = wa.get("workaround") or ""
        if not desc:
            continue
        wa_node = _upsert_node(
            db, topic, "workaround", _slug(desc), desc,
            metadata={
                "gap": wa.get("gap"),
                "user_quote": wa.get("user_quote"),
                "frequency": wa.get("frequency"),
                "aliases": wa.get("aliases"),
            },
        )
        _upsert_edge(db, topic, topic_node, wa_node, "has_workaround")
        summary["workarounds_added"] += 1
        summary["evidence_edges"] += _link_evidence(
            db, topic, wa_node, wa.get("example_post_ids") or [], "built_in",
        )
        # If the workaround names a gap, try to link it back to a same-named painpoint
        gap = wa.get("gap")
        if gap:
            gap_slug = _slug(gap)
            gap_pp = make_node_id(topic, "painpoint", gap_slug)
            if db["graph_nodes"].count_where("id = ?", [gap_pp]) > 0:
                _upsert_edge(db, topic, wa_node, gap_pp, "solves")

    return summary


def enrich_from_llm(
    topic: str,
    provider: str | None = None,
    corpus_limit: int = 120,
    min_score: int = 1,
) -> dict[str, Any]:
    """Run find_gaps() against the corpus, then persist to the graph.

    If `provider` is None (the default), resolve it from the user's saved
    `LLM_PROVIDER` / env keys / reachable Ollama — *don't* silently fall back
    to Anthropic just because it's the first alphabetic option. That caused a
    bug where users with only Ollama configured got "ANTHROPIC_API_KEY not
    set" errors.

    If no provider is configured at all, returns `{ok: False, skipped: True,
    reason: ...}` instead of raising — lets the UI call this optimistically
    after every collect without needing to pre-check.
    """
    import os

    from ..analyze.providers.base import (
        _PROVIDER_ENV_KEY as key_for,
        _ollama_reachable,
        resolve_provider,
    )

    # Delegate to the shared resolver. One implementation. Never drift.
    try:
        provider = resolve_provider(provider)
    except RuntimeError as e:
        return {
            "ok": False,
            "skipped": True,
            "reason": str(e),
            "topic": topic,
        }

    # Double-check the resolved provider still has its key by the time we
    # run — .env could have been edited between resolve and use in theory.
    # Return skip-gracefully so the UI shows a banner instead of an error.
    if provider == "ollama" and not _ollama_reachable():
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": "Ollama is configured but not reachable — start the service in Settings",
        }
    if provider in key_for and not os.getenv(key_for[provider]):
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": f"{key_for[provider]} not set — add it in Settings → API keys",
        }

    try:
        report = find_gaps(
            topic=topic, provider=provider, corpus_limit=corpus_limit, min_score=min_score
        )
    except Exception as e:
        set_keys = [k for k in key_for.values() if os.getenv(k)]
        diag = (
            f"[resolved_provider={provider!r}, "
            f"LLM_PROVIDER={os.getenv('LLM_PROVIDER')!r}, "
            f"LLM_MODEL={os.getenv('LLM_MODEL')!r}, "
            f"env_keys_set={set_keys}]"
        )
        return {
            "ok": False,
            "error": f"enrich failed: {e}  {diag}",
            "topic": topic,
        }
    if report.get("error"):
        return {"ok": False, "error": report["error"], "topic": topic}

    summary = upsert_semantic(
        topic=topic,
        painpoints=report.get("painpoints") if isinstance(report.get("painpoints"), list) else [],
        feature_wishes=(
            report.get("feature_wishes") if isinstance(report.get("feature_wishes"), list) else []
        ),
        product_complaints=(
            report.get("product_complaints")
            if isinstance(report.get("product_complaints"), list)
            else []
        ),
        diy_workarounds=(
            report.get("diy_workarounds")
            if isinstance(report.get("diy_workarounds"), list)
            else []
        ),
    )
    summary["ok"] = True
    summary["corpus_size"] = report.get("corpus_size")
    summary["provider"] = provider
    return summary
