"""Semantic enrichment — persists LLM-extracted painpoints / feature wishes /
product complaints / DIY workarounds as graph nodes + edges.

Entry points:
  - enrich_from_llm(topic, provider):             runs find_gaps() against the
                                                  whole topic corpus (CLI path,
                                                  needs LLM key)
  - enrich_from_llm_for_posts(topic, post_ids):   runs the same 4 extractors
                                                  but scoped to a 5-post batch
                                                  (incremental-enrichment worker)
  - upsert_semantic(topic, ...):                  accepts pre-extracted payloads
                                                  (MCP path, Claude is the LLM
                                                  and passes structured data in)
"""
from __future__ import annotations

import re
from typing import Any, Iterable

from ..core.db import get_db
from ..research.gaps import find_gaps
from ..research.relevance import filter_findings
from .build import _upsert_edge, _upsert_node
from .schema import ensure_graph_schema, make_node_id


def _slug(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (label or "").lower()).strip("-")
    return s[:60] or "unnamed"


def _ensure_source_node(db, topic: str, source_label: str) -> str:
    """Ensure a canonical source node exists for a source_type label."""
    key = _slug(source_label or "unknown")
    _upsert_node(db, topic, "source", key, source_label or "unknown")
    return make_node_id(topic, "source", key)


def _link_evidence(db, topic: str, sem_node: str, post_ids: Iterable[str], kind: str) -> int:
    """Create evidence edges from semantic node → posts AND semantic node →
    source nodes. The source edges are weighted by count (painpoint evidenced
    by 7 reddit posts + 3 arxiv papers → two edges, weights 7 and 3).

    Why both: the raw post edges are what the UI drills into; the source
    edges are what the graph viz renders as a cross-source link grid. Also
    lets downstream queries ask "which painpoints are multi-source" without
    walking through the post table.

    Stamps source-breakdown + source-diversity into the semantic node's
    metadata so the Evidence tab can render badges without a second round-
    trip. These are only set on rows we actually persist, so a painpoint
    with 0 matched post_ids still renders cleanly (empty badges).
    """
    n = 0
    source_counts: dict[str, int] = {}
    real_pids: list[str] = []
    for pid in post_ids or []:
        if not pid:
            continue
        post_node = make_node_id(topic, "post", pid)
        # Only link if the post exists in the graph (was collected)
        if db["graph_nodes"].count_where("id = ?", [post_node]) == 0:
            continue
        _upsert_edge(db, topic, sem_node, post_node, kind)
        real_pids.append(pid)
        n += 1

    # Roll up source_type for every post we just linked. One SQL round-trip
    # instead of one per post — important when painpoints have 20+ evidence
    # posts each.
    if real_pids:
        placeholders = ",".join(["?"] * len(real_pids))
        rows = list(db.query(
            f"SELECT coalesce(source_type, 'reddit') AS src, count(*) AS n "
            f"FROM posts WHERE id IN ({placeholders}) GROUP BY src",
            real_pids,
        ))
        for r in rows:
            source_counts[r["src"]] = int(r["n"] or 0)

        # Add painpoint → source edges (weighted). Keeps the "skeleton" view
        # of the graph cross-source-meaningful without dragging 9k post
        # nodes in. Edge kind = "source_evidence".
        for src, count in source_counts.items():
            source_node = _ensure_source_node(db, topic, src)
            _upsert_edge(db, topic, sem_node, source_node, "source_evidence", weight=float(count))

        # Stamp source breakdown + diversity into the semantic node metadata
        # so the UI can render source badges directly from the node row.
        import json
        diversity = len([v for v in source_counts.values() if v > 0])
        db.conn.execute(
            """UPDATE graph_nodes SET metadata_json = json_patch(
                  coalesce(metadata_json, '{}'),
                  json(:patch)
               ) WHERE id = :id""",
            {
                "id": sem_node,
                "patch": json.dumps({
                    "source_breakdown": source_counts,
                    "source_diversity": diversity,
                    "evidence_count": n,
                }),
            },
        )
        db.conn.commit()

        # Link semantic finding to concrete document elements for provenance
        # jumps (page/bbox) when local-file artifacts exist for the evidence
        # posts. Edges are best-effort and additive.
        try:
            placeholders = ",".join(["?"] * len(real_pids))
            elem_rows = list(
                db.query(
                    f"""
                    SELECT id, document_id, post_id
                    FROM document_elements
                    WHERE topic = ?
                      AND post_id IN ({placeholders})
                    """,
                    [topic, *real_pids],
                )
            )
            for er in elem_rows:
                elem_node = make_node_id(topic, "document_element", str(er["id"]))
                if db["graph_nodes"].count_where("id = ?", [elem_node]) == 0:
                    continue
                _upsert_edge(
                    db,
                    topic,
                    sem_node,
                    elem_node,
                    "supports",
                    metadata={"post_id": er.get("post_id"), "document_id": er.get("document_id")},
                )
        except Exception:
            pass

    return n


def backfill_source_evidence(topic: str) -> dict[str, Any]:
    """Retrofit source_evidence edges + source_breakdown metadata for existing
    semantic findings that already have post-level evidence edges.

    Useful for older topics created before source_evidence was added, where the
    graph has findings but no finding->source links in Map.
    """
    db = get_db()
    evidence_kinds = ("evidenced_by", "wished_in", "about_product", "built_in", "solves")
    sem_kinds = ("painpoint", "feature_wish", "product", "workaround")
    ph_e = ",".join(["?"] * len(evidence_kinds))
    ph_s = ",".join(["?"] * len(sem_kinds))

    rows = list(
        db.query(
            f"""
            SELECT e.src AS sem_id, p.id AS post_id, coalesce(p.source_type, 'reddit') AS src
            FROM graph_edges e
            JOIN posts p ON p.id = replace(e.dst, ?, '')
            JOIN graph_nodes n ON n.id = e.src
            WHERE e.topic = ?
              AND e.kind IN ({ph_e})
              AND n.kind IN ({ph_s})
              AND e.dst LIKE ?
            """,
            [f"{topic}::post::", topic, *evidence_kinds, *sem_kinds, f"{topic}::post::%"],
        )
    )

    if not rows:
        return {"ok": True, "topic": topic, "updated_nodes": 0, "source_edges_added": 0}

    by_sem: dict[str, dict[str, int]] = {}
    for r in rows:
        sem_id = r.get("sem_id")
        src = r.get("src") or "reddit"
        if not sem_id:
            continue
        by_sem.setdefault(sem_id, {})
        by_sem[sem_id][src] = by_sem[sem_id].get(src, 0) + 1

    import json
    updated_nodes = 0
    source_edges_added = 0
    for sem_id, src_counts in by_sem.items():
        for src, count in src_counts.items():
            source_node = _ensure_source_node(db, topic, src)
            _upsert_edge(db, topic, sem_id, source_node, "source_evidence", weight=float(count))
            source_edges_added += 1
        diversity = len([v for v in src_counts.values() if v > 0])
        db.conn.execute(
            """UPDATE graph_nodes SET metadata_json = json_patch(
                  coalesce(metadata_json, '{}'),
                  json(:patch)
               ) WHERE id = :id""",
            {
                "id": sem_id,
                "patch": json.dumps(
                    {
                        "source_breakdown": src_counts,
                        "source_diversity": diversity,
                        "evidence_count": int(sum(src_counts.values())),
                    }
                ),
            },
        )
        updated_nodes += 1
    db.conn.commit()
    return {
        "ok": True,
        "topic": topic,
        "updated_nodes": updated_nodes,
        "source_edges_added": source_edges_added,
    }


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
    # Alias lookup only — if a prior LLM canonicalization bound this topic
    # to another form, collapse onto the canonical. No auto-rewriting of
    # user input.
    try:
        from ..research.topic_resolver import resolve_topic
        topic = resolve_topic(topic, register=False) or topic
    except Exception:
        pass
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

    # Dense cross-finding relations — the old tree-only graph shows the user
    # disconnected islands for every finding. This post-pass uses ChromaDB's
    # MiniLM embedder to create relates_to / potentially_solves / could_address
    # / co_evidenced edges across the finding set, so the map forms proper
    # connections instead of a hairball. Best-effort: silent skip if chromadb
    # is missing (graph still works, just sparse). See graph/relations.py.
    try:
        from .relations import build_semantic_relations
        rel_summary = build_semantic_relations(topic)
        if rel_summary.get("ok") and not rel_summary.get("skipped"):
            summary["relates_to_edges"] = rel_summary.get("relates_to_edges", 0)
            summary["co_evidenced_edges"] = rel_summary.get("co_evidenced_edges", 0)
            summary["evidence_edges"] += rel_summary.get("edges_written", 0)
        elif rel_summary.get("skipped"):
            summary["semantic_relations_skipped"] = rel_summary.get("reason")
    except Exception as e:
        summary["semantic_relations_error"] = str(e)

    return summary


def enrich_from_llm(
    topic: str,
    provider: str | None = None,
    corpus_limit: int = 120,
    min_score: int = 1,
    only: str | None = None,
    parallel: bool = False,
    progress_cb: Any = None,
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
        build_fallback_chain,
    )

    # Build the chain once so we can both pre-flight (is anything configured?)
    # and surface which providers will be tried on failure. If the user pinned
    # an explicit provider, the chain becomes a single-entry list so there's
    # no silent substitution of something they didn't pick.
    chain = (
        [provider.lower()] if provider
        else build_fallback_chain()
    )
    if not chain:
        return {
            "ok": False,
            "skipped": True,
            "topic": topic,
            "reason": "No LLM provider configured — add a key in Settings → API keys.",
        }

    # Passing provider=None into find_gaps lets get_provider(None) return a
    # FallbackProvider that walks the full chain on each LLM call. When the
    # user pinned an explicit provider we pass it through unchanged so there's
    # no surprise substitution. See analyze/providers/base.py::FallbackProvider.
    try:
        report = find_gaps(
            topic=topic,
            provider=(provider if provider else None),
            corpus_limit=corpus_limit,
            min_score=min_score,
            only=only,
            parallel=parallel,
            progress_cb=progress_cb,
        )
    except Exception as e:
        set_keys = [k for k in key_for.values() if os.getenv(k)]
        diag = (
            f"[chain={chain!r}, "
            f"LLM_PROVIDER={os.getenv('LLM_PROVIDER')!r}, "
            f"LLM_MODEL={os.getenv('LLM_MODEL')!r}, "
            f"env_keys_set={set_keys}]"
        )
        return {
            "ok": False,
            "error": f"enrich failed: {e}  {diag}",
            "topic": topic,
            "provider_chain": chain,
        }
    if report.get("error"):
        return {"ok": False, "error": report["error"], "topic": topic}

    finding_threshold = float(os.getenv("GAPMAP_FINDING_REL_THRESHOLD", "0.45"))
    pain_res = filter_findings(
        topic,
        report.get("painpoints") if isinstance(report.get("painpoints"), list) else [],
        threshold=finding_threshold,
        label_key="painpoint",
        alt_keys=("title", "name"),
    )
    wish_res = filter_findings(
        topic,
        report.get("feature_wishes") if isinstance(report.get("feature_wishes"), list) else [],
        threshold=finding_threshold,
        label_key="feature",
        alt_keys=("title", "name"),
    )
    complaint_res = filter_findings(
        topic,
        report.get("product_complaints") if isinstance(report.get("product_complaints"), list) else [],
        threshold=finding_threshold,
        label_key="complaint",
        alt_keys=("title", "painpoint", "name"),
    )
    workaround_res = filter_findings(
        topic,
        report.get("diy_workarounds") if isinstance(report.get("diy_workarounds"), list) else [],
        threshold=finding_threshold,
        label_key="workaround",
        alt_keys=("title", "name"),
    )

    summary = upsert_semantic(
        topic=topic,
        painpoints=pain_res.get("kept", []),
        feature_wishes=wish_res.get("kept", []),
        product_complaints=complaint_res.get("kept", []),
        diy_workarounds=workaround_res.get("kept", []),
    )
    summary["ok"] = True
    summary["corpus_size"] = report.get("corpus_size")
    # `provider_chain` is what we would try in order; `provider` remains for
    # back-compat (first entry of chain, or the explicit pin).
    summary["provider"] = chain[0] if chain else None
    summary["provider_chain"] = chain
    summary["finding_relevance_threshold"] = finding_threshold
    summary["dropped_off_topic_findings"] = {
        "painpoints": len(pain_res.get("dropped", [])),
        "feature_wishes": len(wish_res.get("dropped", [])),
        "product_complaints": len(complaint_res.get("dropped", [])),
        "diy_workarounds": len(workaround_res.get("dropped", [])),
    }
    return summary


# ─── per-post extractor (incremental-enrichment worker path) ───────────────

def _corpus_rows_for_posts(topic: str, post_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch post rows scoped to a specific set of post_ids joined through
    ``topic_posts`` for the given topic. Mirrors the SELECT shape of
    ``collect.corpus_for`` so the existing ``corpus_format`` helper renders
    the rows identically. Empty list if nothing matches — the caller skips
    the LLM call in that case.

    Uses an IN clause with a bounded placeholder count; batches above ~900
    would hit SQLite's variable limit, but the worker enforces
    ``BATCH_SIZE=5`` so we'll never approach that ceiling.
    """
    post_ids = [p for p in (post_ids or []) if p]
    if not post_ids:
        return []
    db = get_db()
    placeholders = ",".join("?" for _ in post_ids)
    sql = f"""
        SELECT p.id, p.sub, p.author, p.title, p.selftext,
               p.score, p.num_comments, p.created_utc, p.permalink,
               p.url, coalesce(p.source_type, 'reddit') AS source_type
        FROM posts p
        JOIN topic_posts tp ON tp.post_id = p.id
        WHERE tp.topic = ?
          AND p.id IN ({placeholders})
    """
    return list(db.query(sql, [topic, *post_ids]))


# Task 9.5 — Provider / model pricing. Values are $/1M tokens for (input,
# output). Sourced from each vendor's public pricing page at 2026-04-21.
# Missing entries default to (0.0, 0.0) — the token count still lands in
# extraction_daily_usage but est_usd stays 0 so users aren't misled into
# thinking we're charging a free model.
_PROVIDER_PRICING: dict[tuple[str, str], tuple[float, float]] = {
    # Anthropic
    ("anthropic", "claude-haiku-4-5"):  (1.00, 5.00),
    ("anthropic", "claude-3-5-haiku"):  (0.80, 4.00),
    ("anthropic", "claude-sonnet-4-5"): (3.00, 15.00),
    ("anthropic", "claude-sonnet-4-6"): (3.00, 15.00),
    ("anthropic", "claude-opus-4-7"):   (15.00, 75.00),
    # OpenAI
    ("openai", "gpt-4o-mini"):          (0.15, 0.60),
    ("openai", "gpt-4o"):                (2.50, 10.00),
    ("openai", "gpt-4.1-mini"):          (0.40, 1.60),
    # OpenRouter (widely-used cheap models)
    ("openrouter", "google/gemini-2.5-flash"):          (0.075, 0.30),
    ("openrouter", "google/gemini-3.1-flash-lite"):     (0.075, 0.30),
    ("openrouter", "meta-llama/llama-3.3-70b-instruct"):(0.60, 0.80),
    # Groq
    ("groq", "llama-3.3-70b-versatile"): (0.59, 0.79),
    ("groq", "llama-3.1-70b-versatile"): (0.59, 0.79),
    ("groq", "llama-3.3-8b-instant"):    (0.05, 0.08),
    # DeepSeek
    ("deepseek", "deepseek-chat"):       (0.27, 1.10),
    ("deepseek", "deepseek-reasoner"):   (0.55, 2.19),
    # Google Gemini (direct)
    ("google", "gemini-2.5-flash"):      (0.075, 0.30),
    ("google", "gemini-2.5-pro"):        (1.25, 5.00),
    # Local — free
    ("ollama", "*"):                     (0.0, 0.0),
}


def _lookup_pricing(provider: str, model: str) -> tuple[float, float]:
    """Best-effort pricing lookup. Falls back to (0,0) when the exact
    (provider, model) pair isn't mapped."""
    if not provider:
        return (0.0, 0.0)
    p = provider.lower()
    m = (model or "").lower()
    if (p, m) in _PROVIDER_PRICING:
        return _PROVIDER_PRICING[(p, m)]
    # ollama (local) — price zero regardless of model name.
    if p == "ollama":
        return (0.0, 0.0)
    return (0.0, 0.0)


def _record_token_usage(
    tokens_in: int,
    tokens_out: int,
    provider: str | None,
    model: str | None,
) -> None:
    """Upsert today's row in ``extraction_daily_usage``. Never raises — token
    accounting is best-effort; a transient SQLite error must not break the
    extraction pipeline."""
    if not tokens_in and not tokens_out:
        return
    try:
        import os as _os
        from datetime import datetime as _dt
        prov = (provider or "unknown").lower()
        mdl = (model or _os.getenv("LLM_MODEL") or "unknown")
        day = _dt.now().strftime("%Y-%m-%d")
        p_in, p_out = _lookup_pricing(prov, mdl)
        est = (tokens_in * p_in + tokens_out * p_out) / 1_000_000.0
        db = get_db()
        # Ensure a row exists with zero counters, then additive UPDATE. Cheap
        # — the PK makes INSERT OR IGNORE a pure constraint check on hit.
        db.conn.execute(
            "INSERT OR IGNORE INTO extraction_daily_usage "
            "(day, provider, model, tokens_in, tokens_out, est_usd) "
            "VALUES (?, ?, ?, 0, 0, 0)",
            (day, prov, mdl),
        )
        db.conn.execute(
            "UPDATE extraction_daily_usage "
            "SET tokens_in = tokens_in + ?, "
            "    tokens_out = tokens_out + ?, "
            "    est_usd = est_usd + ? "
            "WHERE day = ? AND provider = ? AND model = ?",
            (int(tokens_in), int(tokens_out), float(est), day, prov, mdl),
        )
        db.conn.commit()
    except Exception:
        pass


def _estimate_tokens(prompt: str, response: str) -> tuple[int, int]:
    """Fallback token estimator: `chars // 4` per OpenAI's rule of thumb.

    Used when the provider doesn't expose a usage object. Accurate enough
    for the Settings cost estimator (within ~20% of real usage on English
    text); no one uses this to bill customers, so the drift is acceptable.
    """
    def _est(s: str) -> int:
        return max(0, (len(s or "")) // 4)
    return (_est(prompt), _est(response))


def _run_extractor_on_rows(
    extractor_name: str,
    topic: str,
    rows: list[dict[str, Any]],
    provider: str | None = None,
) -> list[dict] | dict:
    """Run a single extractor prompt against a pre-fetched corpus.

    Parallel to ``research.gaps.run_extractor`` but bypasses ``corpus_for``
    so we can scope the prompt to just the N posts in the current batch.
    Keeps the same Ollama-tuning heuristics (shorter excerpts, lower
    ``max_tokens``) so a local model doesn't fall over on the per-post path.
    """
    import os as _os

    from ..analyze.providers.base import get_provider, resolve_provider
    from ..research.corpus_format import format_corpus as _format_corpus
    from ..research.gaps import _parse_json
    from ..research.prompts import load_extractor

    if not rows:
        return []
    ext = load_extractor(extractor_name)
    resolved = resolve_provider(provider)
    default_excerpt = 250 if resolved == "ollama" else 600
    try:
        excerpt_chars = int(_os.getenv("CORPUS_EXCERPT_CHARS") or default_excerpt)
    except ValueError:
        excerpt_chars = default_excerpt
    corpus = _format_corpus(rows, excerpt_chars=excerpt_chars)
    max_tokens = 2048
    if resolved == "ollama":
        try:
            max_tokens = min(max_tokens, int(_os.getenv("EXTRACTOR_MAX_TOKENS") or 1024))
        except ValueError:
            max_tokens = 1024
    user = ext["user_template"].format(topic=topic, corpus=corpus)
    raw = get_provider(provider).complete(
        prompt=user,
        system=ext["system"],
        max_tokens=max_tokens,
        temperature=0.2,
    )
    # Task 9.5 — record daily token usage. The LLMProvider.complete surface
    # returns a bare string so we can't read vendor usage blocks; fall back
    # to the char-count estimator. Best-effort: any failure is swallowed by
    # _record_token_usage.
    try:
        sys_text = ext.get("system") or ""
        in_tok, out_tok = _estimate_tokens(sys_text + "\n" + user, raw or "")
        _record_token_usage(in_tok, out_tok, resolved, _os.getenv("LLM_MODEL"))
    except Exception:
        pass
    return _parse_json(raw)


def _stamp_evidence_post_ids(
    topic: str,
    post_ids: list[str],
    summary_before: dict[str, Any] | None,
) -> int:
    """After ``upsert_semantic``, stamp ``evidence_post_id`` on every semantic
    node whose ``evidenced_by|wished_in|built_in`` edge points to one of the
    batch's posts. Only writes when the column is currently empty, so a node
    that was first evidenced by post_A keeps A as its "origin post" even if a
    later batch adds post_B as additional evidence.

    Returns the count of rows updated — used for the summary dict only.
    """
    _ = summary_before  # reserved for future delta reporting
    post_ids = [p for p in (post_ids or []) if p]
    if not post_ids:
        return 0
    db = get_db()
    placeholders = ",".join("?" for _ in post_ids)
    # Build a set of (semantic_node_id, first_evidence_post_id) pairs from
    # graph_edges. A single query — much cheaper than per-node updates when
    # the batch yields 20+ findings.
    sql = f"""
        SELECT ge.src AS node_id, MIN(tp.post_id) AS first_post_id
          FROM graph_edges ge
          JOIN topic_posts tp ON tp.post_id IN ({placeholders})
         WHERE ge.topic = ?
           AND ge.kind IN ('evidenced_by', 'wished_in', 'built_in')
           AND ge.dst IN (
                 SELECT id FROM graph_nodes
                  WHERE topic = ? AND kind = 'post'
                    AND id IN ({",".join(['?'] * len(post_ids))})
               )
         GROUP BY ge.src
    """
    # We need node_ids for the post graph nodes to match ge.dst. The post
    # node id format is ``<topic>::post::<post_id>`` (see schema.make_node_id).
    post_node_ids = [make_node_id(topic, "post", pid) for pid in post_ids]
    try:
        rows = list(db.query(sql, [*post_ids, topic, topic, *post_node_ids]))
    except Exception:
        return 0
    updated = 0
    for r in rows:
        node_id = r.get("node_id")
        first_pid = r.get("first_post_id")
        if not node_id or not first_pid:
            continue
        try:
            db.conn.execute(
                "UPDATE graph_nodes SET evidence_post_id = ? "
                "WHERE id = ? AND (evidence_post_id IS NULL OR evidence_post_id = '')",
                (first_pid, node_id),
            )
            updated += db.conn.total_changes and 1 or 0
        except Exception:
            continue
    try:
        db.conn.commit()
    except Exception:
        pass
    return updated


def enrich_from_llm_for_posts(
    topic: str,
    post_ids: list[str],
    provider: str | None = None,
) -> tuple[int, int, int]:
    """Per-post LLM enrichment — the entry point used by
    ``research.enrich_worker``.

    Pulls the ``posts`` rows for ``post_ids`` (joined through ``topic_posts``
    so the topic scope is enforced), runs the 4 extractors
    (painpoints / feature_wishes / product_complaints / diy_workarounds) with
    the batch as the corpus, then upserts findings via ``upsert_semantic``.
    Stamps ``evidence_post_id`` on every freshly-written semantic node so the
    Task 1 backfill query ``LEFT JOIN … ON gn.evidence_post_id = tp.post_id``
    can tell which posts have been extracted.

    Palace embedding is handled inside ``upsert_semantic`` (it runs
    ``cluster_findings`` which calls the shared embedder). When chromadb
    isn't installed clustering is a passthrough — graph writes still land
    and the function returns a meaningful finding count.

    Returns ``(n_findings, tokens_in, tokens_out)``. The base ``LLMProvider``
    surface doesn't expose token usage yet (``complete()`` returns a bare
    string), so ``tokens_in`` and ``tokens_out`` are always ``0`` for now —
    wiring those through is Task 9.5 of the incremental-enrichment plan.
    Returning the tuple from the start lets the worker write usage rows once
    the provider API is extended without a caller-side refactor.
    """
    ensure_graph_schema()

    rows = _corpus_rows_for_posts(topic, post_ids)
    if not rows:
        return (0, 0, 0)

    # Run the same 4 extractors the whole-topic path uses. Each may return a
    # dict (parse failure) — we filter those out so ``upsert_semantic``
    # always sees a list.
    def _as_list(val: Any) -> list[dict]:
        return val if isinstance(val, list) else []

    painpoints = _as_list(_run_extractor_on_rows("painpoints", topic, rows, provider))
    feature_wishes = _as_list(_run_extractor_on_rows("features", topic, rows, provider))
    product_complaints = _as_list(_run_extractor_on_rows("complaints", topic, rows, provider))
    diy_workarounds = _as_list(_run_extractor_on_rows("diy", topic, rows, provider))
    finding_threshold = 0.45
    painpoints = filter_findings(
        topic, painpoints, threshold=finding_threshold, label_key="painpoint", alt_keys=("title", "name")
    ).get("kept", [])
    feature_wishes = filter_findings(
        topic, feature_wishes, threshold=finding_threshold, label_key="feature", alt_keys=("title", "name")
    ).get("kept", [])
    product_complaints = filter_findings(
        topic, product_complaints, threshold=finding_threshold, label_key="complaint", alt_keys=("title", "painpoint", "name")
    ).get("kept", [])
    diy_workarounds = filter_findings(
        topic, diy_workarounds, threshold=finding_threshold, label_key="workaround", alt_keys=("title", "name")
    ).get("kept", [])

    summary = upsert_semantic(
        topic=topic,
        painpoints=painpoints,
        feature_wishes=feature_wishes,
        product_complaints=product_complaints,
        diy_workarounds=diy_workarounds,
    )

    # Stamp evidence_post_id — best-effort, never blocks the worker. The
    # column is nullable so a failure here just means the next backfill run
    # will re-queue these posts (harmless — upserts are idempotent).
    try:
        _stamp_evidence_post_ids(topic, post_ids, summary)
    except Exception:
        pass

    # Palace upsert for the newly extracted findings is already handled via
    # ``cluster_findings`` inside ``upsert_semantic`` (it runs the shared
    # embedder over every finding label). If chromadb isn't installed, the
    # cluster step passes through untouched — findings still land in
    # graph_nodes, just without duplicate collapsing.

    n_findings = int(
        (summary.get("painpoints_added") or 0)
        + (summary.get("feature_wishes_added") or 0)
        + (summary.get("products_added") or 0)
        + (summary.get("workarounds_added") or 0)
    )
    # Token accounting: the base provider returns a bare string; surface zero
    # until the provider interface is extended to return usage metadata.
    return (n_findings, 0, 0)
