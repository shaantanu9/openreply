"""Unified gap-discovery pipeline.

Fuses the three retrieval layers we already have into one end-to-end
"find the real gaps, explain them, cite them" run:

  1. PALACE (ChromaDB + ONNX MiniLM + BM25 hybrid) — semantically retrieve
     the most signal-dense posts for the topic, including cross-source
     siblings the plain SQL filter would miss.
  2. LLM extraction (chunked + merged via insights_chunked) — extract a
     deduped findings list with importance/satisfaction/frequency that
     already uses map-reduce so low-credit providers can run it.
  3. Palace post-hoc clustering — for every finding, use palace
     `search_posts(finding.title)` to attach top-K evidence posts across
     ALL sources (not just the chunk the finding was extracted from).
     This links Reddit pain to matching HN discussions, arXiv papers,
     and App-Store reviews on the same theme.
  4. Science fetch (arXiv + OpenAlex + PubMed) per painpoint, already
     persisted as `evidence_paper` graph_nodes with `has_evidence` edges.
  5. Solutions pipeline (Why → Science → Intervention) already builds
     mechanism + intervention nodes + supported_by edges.
  6. Research linker — embed findings + fetched papers into palace so
     subsequent searches surface them too, and hop through palace to
     suggest experiment ideas ("these 3 ML papers propose an RCT
     protocol for this pain").

Output: a single JSON blob the UI can render, plus every intermediate
artifact lands in SQLite (graph_nodes / graph_edges / topic_insights /
research_links / paper_analyses) so the rest of the app (map / insights
/ solutions / research tabs) picks them up for free.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_experiments_table() -> None:
    """LLM-proposed experiments derived from linked papers.

    One row per (topic, painpoint, experiment) triple. The `design_json`
    column holds the full structured experiment spec (hypothesis,
    method, n-required, outcome metric, cost estimate).
    """
    db = get_db()
    if "experiments" in db.table_names():
        return
    db["experiments"].create(
        {
            "topic": str,
            "painpoint_id": str,
            "title": str,
            "hypothesis": str,
            "method": str,
            "n_required": int,
            "outcome_metric": str,
            "duration_days": int,
            "cost_estimate": str,
            "citations_json": str,  # list[{title, url, tier}]
            "design_json": str,     # full LLM output
            "provider": str,
            "model": str,
            "created_at": str,
        },
        pk=("topic", "painpoint_id", "title"),
    )
    db["experiments"].create_index(["topic"])
    db["experiments"].create_index(["painpoint_id"])


def _propose_experiment_for_painpoint(
    painpoint_label: str,
    why: dict[str, Any],
    papers: list[dict[str, Any]],
    provider: str | None = None,
) -> dict[str, Any]:
    """Ask the LLM to design one validation experiment for this painpoint.

    Grounded in the fetched papers so the proposed method mirrors an
    actual published protocol. Returns a dict with hypothesis, method,
    n_required, outcome_metric, duration_days, cost_estimate, citations.
    """
    from ..analyze.providers.base import get_provider, resolve_provider

    try:
        provider = resolve_provider(provider)
    except Exception:
        return {"_skipped": True, "reason": "no_llm_provider"}
    prov = get_provider(provider)

    # Compress papers into 4-line snippets so the prompt fits tight budgets.
    paper_lines = []
    for p in papers[:5]:
        title = (p.get("title") or "")[:140]
        tier = p.get("tier") or "?"
        year = p.get("year") or ""
        url = p.get("url") or p.get("permalink") or ""
        paper_lines.append(f"[{tier}|{year}] {title} — {url}")
    paper_block = "\n".join(paper_lines) or "(no papers found)"

    why_block = json.dumps(
        {
            "mechanism": (why.get("mechanism") or {}).get("hypothesis") or "",
            "jtbd": (why.get("jtbd") or {}).get("desired_outcome") or "",
            "confounders": (why.get("confounders") or [])[:3],
        },
        ensure_ascii=False,
        indent=2,
    )

    system = (
        "You design the smallest-N experiment that could validate or falsify a "
        "hypothesis about a user painpoint. Ground every design choice in the "
        "cited papers. Return STRICT JSON."
    )
    user = (
        f"Painpoint: {painpoint_label}\n\n"
        f"Why analysis:\n{why_block}\n\n"
        f"Relevant papers:\n{paper_block}\n\n"
        'Return JSON: {"title": "...", "hypothesis": "falsifiable statement", '
        '"method": "exp-design (between-subjects RCT / single-case ABA / '
        'wizard-of-oz / diary study / ...)", "n_required": 30, '
        '"outcome_metric": "measurable KPI", "duration_days": 14, '
        '"cost_estimate": "USD range", '
        '"citations": [{"title":"...","url":"...","tier":"A"}]}'
    )
    try:
        raw = prov.complete(prompt=user, system=system, max_tokens=600, temperature=0.3)
    except Exception as e:
        return {"_error": str(e)[:200]}

    from .insights import _parse_insight_json
    parsed = _parse_insight_json(raw)
    if parsed.get("_parse_error"):
        return {"_parse_error": parsed.get("_error")}
    return parsed


def _attach_cross_source_evidence(
    topic: str,
    finding_label: str,
    finding_node_id: str,
    k: int = 8,
) -> int:
    """Use palace to find cross-source posts that match this finding.

    Adds `evidenced_by` edges between the finding node and each matching
    post node. Unlike the LLM's per-chunk extraction which only sees one
    chunk at a time, palace can pull signal from the entire topic corpus
    AND similar posts in other topics (palace is global). Idempotent.
    """
    try:
        from ..retrieval import palace
        if not palace.is_available() or not palace.is_model_ready():
            return 0
    except ImportError:
        return 0
    from ..graph.build import _upsert_edge

    hits = palace.search_posts(
        query=finding_label,
        k=k,
        topic=topic,  # only link posts already in this topic
    ) or {}
    results = hits.get("results") if isinstance(hits, dict) else []
    if not results:
        return 0

    db = get_db()
    n_attached = 0
    for hit in results:
        # Palace returns {id: <post_id>, score, text, metadata}. The id
        # is the posts table primary key.
        post_id = hit.get("id") or (hit.get("metadata") or {}).get("post_id")
        if not post_id:
            continue
        # Post node id in graph_nodes is "<topic>::post::<post_id>"
        post_node_id = f"{topic}::post::{post_id}"
        # Only attach if the post node actually exists in the graph
        # (build_graph creates it for posts referenced by findings).
        row = db.execute(
            "SELECT 1 FROM graph_nodes WHERE topic=? AND id=? LIMIT 1",
            [topic, post_node_id],
        ).fetchone()
        if not row:
            # The palace hit is a post we have in SQLite but haven't
            # brought into the graph yet. Pull it in so the edge anchors.
            post = db.execute(
                "SELECT id, title FROM posts WHERE id = ?",
                [post_id],
            ).fetchone()
            if not post:
                continue
            from ..graph.build import _upsert_node
            _upsert_node(
                db, topic, "post", post_id, (post[1] or post_id)[:120],
                metadata={"palace_score": hit.get("score")},
            )
        _upsert_edge(
            db, topic, finding_node_id, post_node_id, "evidenced_by",
            metadata={"via": "palace", "score": hit.get("score")},
        )
        n_attached += 1
    return n_attached


def run_gap_discovery(
    topic: str,
    provider: str | None = None,
    chunk_size: int | None = None,
    max_workers: int | None = None,
    papers_per_painpoint: int = 5,
    propose_experiments: bool = True,
    progress=None,
) -> dict[str, Any]:
    """End-to-end gap discovery for one topic.

    Returns a single summary dict; every step also persists to DB so the
    Map / Insights / Research / Solutions tabs pick up the new nodes.
    """
    def log(msg: str) -> None:
        if progress:
            try: progress(msg)
            except Exception: pass

    log(f"[gap_discovery] starting for topic={topic!r}")
    summary: dict[str, Any] = {
        "ok": True,
        "topic": topic,
        "steps": {},
        "generated_at": _now_iso(),
    }

    # Step 1 — palace availability gate + index this topic's posts so the
    # cross-source attach in step 4 has something to match against.
    palace_ok = False
    palace_indexed = 0
    try:
        from ..retrieval import palace
        palace_ok = palace.is_available() and palace.is_model_ready()
        if palace_ok:
            # Pull every post tagged to this topic and upsert it to palace
            # (idempotent — already-indexed posts are skipped). Without this
            # step, palace.search_posts returns 0 matches for brand-new
            # topics whose posts haven't been touched by the bulk indexer.
            db = get_db()
            posts = list(db.query(
                """
                SELECT p.id, p.title, p.selftext, p.sub, p.author,
                       p.score, p.num_comments, p.created_utc,
                       COALESCE(p.source_type, 'reddit') AS source_type
                FROM topic_posts tp
                JOIN posts p ON p.id = tp.post_id
                WHERE tp.topic = :t
                LIMIT 1000
                """,
                {"t": topic},
            ))
            if posts:
                res = palace.upsert_posts_many(posts, topic=topic) or {}
                palace_indexed = int(res.get("added") or res.get("upserted") or len(posts))
    except ImportError:
        palace_ok = False
    summary["steps"]["palace_available"] = palace_ok
    summary["steps"]["palace_indexed"] = palace_indexed
    log(f"[1/6] palace available: {palace_ok} · indexed {palace_indexed} posts")

    # Step 2 — chunked LLM synthesis → finding list persisted to topic_insights.
    log("[2/6] running chunked insight synthesis (LLM)…")
    from .insights import synthesize_insights_chunked
    insights = synthesize_insights_chunked(
        topic=topic,
        provider=provider,
        chunk_size=chunk_size,
        max_workers=max_workers,
        max_tokens_per_chunk=800,
        persist=True,
        progress=progress,
    )
    findings = insights.get("findings") or []
    summary["steps"]["insights"] = {
        "ok": insights.get("ok"),
        "findings_count": len(findings),
        "error": insights.get("error"),
        "mode": insights.get("_mode"),
    }
    if not insights.get("ok") or not findings:
        summary["ok"] = False
        summary["error"] = insights.get("error") or "chunked synth returned no findings"
        return summary

    # Step 3 — convert findings to painpoint graph_nodes so downstream
    # pipelines (solutions / research_linker / experiments) can target them.
    log("[3/6] materialising findings as painpoint nodes…")
    from ..graph.build import _upsert_node, _upsert_edge
    db = get_db()
    topic_node_id = _upsert_node(db, topic, "topic", topic, topic)
    painpoint_ids: list[tuple[str, str]] = []  # (node_id, label)
    for f in findings:
        label = (f.get("title") or "").strip()
        if not label:
            continue
        slug = label.lower().replace(" ", "_")[:60]
        meta = {k: v for k, v in f.items() if k != "title"}
        node_id = _upsert_node(
            db, topic, "painpoint", slug, label, metadata=meta,
        )
        _upsert_edge(db, topic, topic_node_id, node_id, "has_painpoint")
        painpoint_ids.append((node_id, label))
    summary["steps"]["painpoints_materialised"] = len(painpoint_ids)

    # Step 4 — palace cross-source evidence attach for each finding.
    # This is the "all sources → one finding" link the user wants.
    if palace_ok:
        log("[4/6] attaching cross-source evidence via palace…")
        total_edges = 0
        for node_id, label in painpoint_ids:
            total_edges += _attach_cross_source_evidence(topic, label, node_id, k=8)
        summary["steps"]["palace_evidence_edges"] = total_edges
    else:
        summary["steps"]["palace_evidence_edges"] = 0
        log("[4/6] palace not available — skipping cross-source attach")

    # Step 5 — science fetch + solutions pipeline (Why → Papers → Interventions).
    log("[5/6] running solutions pipeline (science + why + interventions)…")
    try:
        from .solutions import solutions_pipeline
        sol = solutions_pipeline(
            topic=topic, provider=provider, papers_per_painpoint=papers_per_painpoint,
        )
        summary["steps"]["solutions"] = sol
    except Exception as e:
        summary["steps"]["solutions"] = {"_error": str(e)[:200]}
        log(f"[5/6] solutions pipeline failed: {e}")

    # Step 6 — link findings into palace via research_linker + propose one
    # experiment per painpoint grounded in the papers we just fetched.
    log("[6/6] research_linker + experiment proposals…")
    try:
        from .research_linker import link_findings_for_topic
        linker = link_findings_for_topic(topic, k=3)
        summary["steps"]["research_linker"] = {
            k: v for k, v in (linker or {}).items() if k != "links"
        }
    except Exception as e:
        summary["steps"]["research_linker"] = {"_error": str(e)[:200]}

    experiments: list[dict[str, Any]] = []
    if propose_experiments:
        _ensure_experiments_table()
        # Pull persisted papers back so we're grounded in what was fetched,
        # not on what the LLM might hallucinate.
        for node_id, label in painpoint_ids:
            papers = list(db.query(
                """
                SELECT gn.label AS title, gn.metadata_json
                FROM graph_edges ge
                JOIN graph_nodes gn ON gn.id = ge.dst AND gn.topic = ge.topic
                WHERE ge.topic = :t AND ge.src = :s
                  AND ge.kind IN ('has_evidence','cites')
                  AND gn.kind = 'evidence_paper'
                LIMIT 5
                """,
                {"t": topic, "s": node_id},
            ))
            paper_dicts = []
            for p in papers:
                try:
                    md = json.loads(p.get("metadata_json") or "{}")
                except Exception:
                    md = {}
                paper_dicts.append({
                    "title": p.get("title") or "",
                    "tier": md.get("tier") or "?",
                    "year": md.get("year") or "",
                    "url": md.get("url") or md.get("permalink") or "",
                })

            why_row = db.execute(
                "SELECT metadata_json FROM graph_nodes WHERE topic=? AND id=? AND kind='painpoint' LIMIT 1",
                [topic, node_id],
            ).fetchone()
            why = {}
            if why_row:
                try: why = json.loads(why_row[0] or "{}")
                except Exception: why = {}

            exp = _propose_experiment_for_painpoint(label, why, paper_dicts, provider=provider)
            if exp.get("_skipped") or exp.get("_error") or exp.get("_parse_error"):
                continue
            title = (exp.get("title") or f"Experiment: {label}").strip()[:180]
            db["experiments"].upsert(
                {
                    "topic": topic,
                    "painpoint_id": node_id,
                    "title": title,
                    "hypothesis": exp.get("hypothesis") or "",
                    "method": exp.get("method") or "",
                    "n_required": int(exp.get("n_required") or 0),
                    "outcome_metric": exp.get("outcome_metric") or "",
                    "duration_days": int(exp.get("duration_days") or 0),
                    "cost_estimate": exp.get("cost_estimate") or "",
                    "citations_json": json.dumps(exp.get("citations") or [], ensure_ascii=False),
                    "design_json": json.dumps(exp, ensure_ascii=False, default=str),
                    "provider": provider or "",
                    "model": "",
                    "created_at": _now_iso(),
                },
                pk=("topic", "painpoint_id", "title"),
            )
            experiments.append({
                "painpoint": label,
                "title": title,
                "hypothesis": exp.get("hypothesis"),
                "method": exp.get("method"),
                "n_required": exp.get("n_required"),
                "citations": exp.get("citations") or [],
            })
    summary["steps"]["experiments"] = {
        "count": len(experiments),
        "items": experiments[:10],
    }

    # Final: tiny top-line preview for the UI.
    summary["preview"] = {
        "findings_count": len(findings),
        "palace_edges": summary["steps"].get("palace_evidence_edges", 0),
        "papers_persisted": (summary["steps"].get("solutions") or {}).get("papers_persisted", 0),
        "interventions_added": (summary["steps"].get("solutions") or {}).get("interventions_added", 0),
        "experiments": len(experiments),
    }
    log(f"[gap_discovery] done: {summary['preview']}")
    return summary


# ────────────────────────────────────────────── persona-filtered gap view ──
# Future extension point. The full gap_discovery run produces a generic
# findings + experiments corpus. Personas (designer / ceo / cto / cfo / pm /
# marketer) re-read that corpus through their own lens — the LLM is prompted
# to filter for what matters TO THAT ROLE, score it on role-specific axes,
# and propose role-specific features.
#
# Current behaviour: only scaffold + data model. Callers pass a persona key;
# we retrieve the existing findings + experiments for the topic, prompt the
# LLM with a persona system message, and return a filtered, re-ranked view.
# No new fetches — all data is already in SQLite by the time a persona is
# applied, so personas are cheap (one LLM call each).

PERSONA_PROMPTS = {
    "designer": (
        "You are a senior product designer. Re-rank findings by UX severity "
        "(task friction, cognitive load, affordance gaps). Propose 3 design "
        "features per top finding."
    ),
    "ceo": (
        "You are a CEO. Re-rank findings by strategic impact (TAM, moat, "
        "churn risk). Propose 3 strategic bets per top finding."
    ),
    "cto": (
        "You are a CTO. Re-rank findings by technical risk and system-design "
        "implications. Propose 3 architectural responses per top finding."
    ),
    "cfo": (
        "You are a CFO. Re-rank findings by revenue impact, CAC/LTV effect, "
        "and unit-economics risk. Propose 3 investable responses per finding."
    ),
    "pm": (
        "You are a senior PM. Re-rank findings by opportunity score × "
        "build-cost. Propose 3 prioritised PRD-shaped features per finding."
    ),
    "marketer": (
        "You are a head of growth. Re-rank findings by acquisition wedge / "
        "positioning leverage. Propose 3 campaign angles per finding."
    ),
}


def apply_persona(
    topic: str,
    persona: str,
    provider: str | None = None,
) -> dict[str, Any]:
    """Re-view existing gap_discovery output through a role-specific lens.

    Call AFTER `run_gap_discovery` — reads findings + experiments from the
    DB, prompts a persona-specific LLM re-rank, returns a filtered view.
    Persistence is opt-in; for now we just return the filtered dict so the
    UI can render it. If you need to store per-persona rankings, add an
    `experiments.persona` column or a separate `persona_views` table.

    Scaffolded 2026-04-21 for the upcoming multi-persona feature. Supported
    keys: designer / ceo / cto / cfo / pm / marketer.
    """
    from ..analyze.providers.base import get_provider, resolve_provider

    system = PERSONA_PROMPTS.get(persona.lower())
    if not system:
        return {"ok": False, "error": f"unknown persona {persona!r}", "available": list(PERSONA_PROMPTS.keys())}

    try:
        provider = resolve_provider(provider)
    except Exception as e:
        return {"ok": False, "skipped": True, "reason": str(e)}
    prov = get_provider(provider)

    # Pull findings + experiments. Keep compact — persona pass is
    # re-interpretation, not re-extraction.
    db = get_db()
    findings = list(db.query(
        "SELECT label, metadata_json FROM graph_nodes WHERE topic=:t AND kind='painpoint' LIMIT 30",
        {"t": topic},
    ))
    experiments = list_experiments(topic)[:10]

    findings_block = "\n".join(
        f"- {r.get('label')}" for r in findings if r.get("label")
    ) or "(none)"
    exp_block = "\n".join(
        f"- {e.get('title')}: {e.get('hypothesis') or ''}"
        for e in experiments
    ) or "(none)"

    user = (
        f"Topic: {topic}\n\n"
        f"Findings (user painpoints extracted from corpus):\n{findings_block}\n\n"
        f"Proposed experiments:\n{exp_block}\n\n"
        'Return STRICT JSON: {"persona": "...", "topic": "...", '
        '"top_findings": [{"title": "...", "why_it_matters_to_you": "...", '
        '"role_specific_score": 0-10, "features_you_would_build": ["...", "..."]}], '
        '"cross_cutting_risks": ["..."], "one_next_action": "..."}'
    )

    try:
        raw = prov.complete(prompt=user, system=system, max_tokens=1200, temperature=0.3)
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}

    from .insights import _parse_insight_json
    parsed = _parse_insight_json(raw)
    if parsed.get("_parse_error"):
        return {"ok": False, "error": parsed.get("_error"), "raw": raw[:600]}
    parsed.setdefault("persona", persona)
    parsed.setdefault("topic", topic)
    parsed["ok"] = True
    return parsed


def list_experiments(topic: str) -> list[dict[str, Any]]:
    """Read back experiments for a topic, newest first."""
    _ensure_experiments_table()
    db = get_db()
    rows = list(db.query(
        "SELECT * FROM experiments WHERE topic = :t ORDER BY created_at DESC",
        {"t": topic},
    ))
    for r in rows:
        try: r["citations"] = json.loads(r.pop("citations_json") or "[]")
        except Exception: r["citations"] = []
        try: r["design"] = json.loads(r.pop("design_json") or "{}")
        except Exception: r["design"] = {}
    return rows
