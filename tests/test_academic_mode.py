"""Academic Mode orchestrator tests.

Mocks the heavy composed functions (paper research, analysis, gaps,
deliberation, export) so the pipeline logic — stage ordering, the hard
grounding gate, citation restriction, governance pauses, and the gate ledger —
is tested deterministically and offline. The traceability writes
(record_check / record_lineage / record_academic_brief) run for real against a
tmp SQLite DB so we can assert the ledger.
"""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def acad_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GAPMAP_SKIP_PALACE", "1")
    from gapmap.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    d = db_mod.get_db()
    db_mod.init_schema(d)
    return d


def _patch_pipeline(monkeypatch: pytest.MonkeyPatch, *, grounded: int,
                    export_ok: bool = True, gaps: int = 2) -> None:
    """Patch every composed function so run_academic_brief runs offline."""
    import gapmap.research.paper_pipeline as pp
    import gapmap.research.paper_analyze as pa
    import gapmap.research.paper_gaps as pg
    import gapmap.research.deliberate as dl
    import gapmap.research.academic_review as ar
    import gapmap.research.academic_integrity as ai
    import gapmap.research.academic_citations as ac

    analyses = [
        {"post_id": f"arxiv_{i}", "title": f"Paper {i}",
         "takeaway": f"takeaway {i}", "summary": f"summary {i}"}
        for i in range(grounded)
    ]

    monkeypatch.setattr(pp, "run_paper_research", lambda *a, **k: {
        "ok": True, "search_total": 10, "analyzed": grounded, "by_source": {"arxiv": grounded},
    })
    monkeypatch.setattr(pa, "analyze_papers_bulk", lambda *a, **k: {
        "ok": True, "analyzed": grounded, "total": grounded,
    })
    monkeypatch.setattr(pa, "get_analyses", lambda *a, **k: list(analyses))
    # NOTE: real detect_gaps returns gap `evidence` as RAW post_id STRINGS
    # (list_gaps hydrates them to dicts). The mock mirrors the detect_gaps shape
    # so the suite exercises the real path.
    monkeypatch.setattr(pg, "detect_gaps", lambda *a, **k: {
        "ok": True, "gaps": [
            {"id": f"g{i}", "title": f"Gap {i}", "detail": f"detail {i}",
             "evidence": [f"arxiv_{i}"]}
            for i in range(gaps)
        ],
    })
    monkeypatch.setattr(dl, "generate_debate_roles", lambda *a, **k: [
        {"key": "skeptic", "name": "Skeptic"},
    ])
    # Multi-reviewer panel — returns an editorial decision + dissent (which
    # surfaces as Acknowledged Limitations). Replaces the old deliberate pass.
    monkeypatch.setattr(ar, "run_review_panel", lambda *a, **k: {
        "ok": True,
        "topic": "focus",
        "editorial_decision": "minor_revision",
        "mean_score": 72.0,
        "critical_blocks": False,
        "reviewers": [
            {"role": "editor_in_chief", "score": 78, "recommendation": "minor"},
            {"role": "methodology_reviewer", "score": 70, "recommendation": "major"},
            {"role": "devils_advocate", "score": 68, "recommendation": "major"},
        ],
        "dissent": [
            {"role": "methodology_reviewer", "recommendation": "major",
             "why": "sample size unclear"},
        ],
        "provider": "mock",
    })
    # Integrity gate — clean PASS by default (per-test override for blocking).
    monkeypatch.setattr(ai, "run_integrity_check", lambda *a, **k: {
        "ok": True, "verdict": "PASS", "blocking": False,
        "sampled": 2, "total": 2, "findings": [], "blocking_findings": [],
    })
    # Citation-existence gate — all grounded ids verify by default.
    monkeypatch.setattr(ac, "verify_citations", lambda post_ids, **k: {
        "ok": True, "total": len(post_ids), "verified": len(post_ids),
        "unresolvable": 0, "missing": 0, "blocking": False, "citations": [],
    })
    # The export references a FABRICATED id that must never reach citations.
    monkeypatch.setattr(pp, "paper_export_with_citations", lambda *a, **k: {
        "ok": export_ok,
        "format": "markdown",
        "content": "# Research Brief\n\nBody citing [fabricated_999].",
        "grounded": True,
    } if export_ok else {"ok": False, "error": "no draft"})


def _ledger_gates(db, run_id: str) -> dict[str, int]:
    rows = list(db.query(
        "SELECT gate, passed FROM checks_ledger WHERE run_id = ?", [run_id]))
    return {r["gate"]: r["passed"] for r in rows}


def test_full_run_l3_produces_grounded_cited_brief(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    from gapmap.research.academic_mode import run_academic_brief

    r = run_academic_brief("focus", level="L3")
    assert r["ok"] is True
    assert r["stage"] == "finalize"
    assert r["gate"] is None
    assert r["grounded_count"] == 3
    # Stage receipts are recorded in pipeline order.
    names = [s["name"] for s in r["stages"]]
    assert names == ["research", "synthesize", "grounding", "peer_review",
                     "finalize", "integrity", "citation"]
    # Multi-agent additions surface in the return.
    assert r["peer_review"]["decision"] == "minor_revision"
    assert r["integrity"]["verdict"] == "PASS"
    assert r["citations_check"]["verified"] == 3
    assert r["passport"]["length"] >= 5  # research..citation appended to the ledger
    brief = r["brief"]
    assert brief["markdown"].startswith("# Research Brief")
    # Peer-review dissent surfaces as Acknowledged Limitations (never dropped).
    assert "Acknowledged Limitations" in brief["markdown"]


def test_citations_restricted_to_committed_academic_papers(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    from gapmap.research.academic_mode import run_academic_brief

    r = run_academic_brief("focus", level="L3")
    cites = r["brief"]["citations"]
    # Citations are exactly the committed academic post_ids — no fabrication.
    assert cites == ["arxiv_0", "arxiv_1", "arxiv_2"]
    assert "fabricated_999" not in cites


def test_grounding_gate_hard_blocks_finalize(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=1)  # below min_grounded=2
    from gapmap.research.academic_mode import run_academic_brief

    r = run_academic_brief("focus", level="L3")
    assert r["ok"] is False
    assert r["gate"] == "coverage"
    assert r["stage"] == "grounding"
    assert r["brief"] is None
    gates = _ledger_gates(acad_env, r["run_id"])
    assert gates.get("academic_grounding") == 0      # gate recorded as failed
    assert "academic_finalize" not in gates          # finalize never ran


def test_l2_pauses_then_finalizes_on_approval(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    from gapmap.research.academic_mode import run_academic_brief

    paused = run_academic_brief("focus", level="L2", approved=False)
    assert paused["ok"] is True
    assert paused["awaiting_approval"] is True
    assert paused["brief"] is None
    assert "academic_finalize" not in _ledger_gates(acad_env, paused["run_id"])

    done = run_academic_brief("focus", level="L2", approved=True)
    assert done["ok"] is True
    assert done["awaiting_approval"] is False
    assert done["brief"]["markdown"].startswith("# Research Brief")


def test_l1_suggest_stops_after_synthesize(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    from gapmap.research.academic_mode import run_academic_brief

    r = run_academic_brief("focus", level="L1")
    assert r["ok"] is True
    assert r["stage"] == "synthesize"
    assert r["brief"] is None
    assert r["suggested_next"] == ["peer_review", "finalize"]
    gates = _ledger_gates(acad_env, r["run_id"])
    assert "academic_peer_review" not in gates
    assert "academic_finalize" not in gates


def test_gate_ledger_records_every_executed_stage(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    from gapmap.research.academic_mode import run_academic_brief

    r = run_academic_brief("focus", level="L3")
    gates = _ledger_gates(acad_env, r["run_id"])
    for g in ("academic_research", "academic_synthesize", "academic_grounding",
              "academic_peer_review", "academic_finalize",
              "academic_integrity", "academic_citation"):
        assert g in gates, f"missing gate {g}"
    assert gates["academic_grounding"] == 1  # passed


def test_brief_persists_and_is_readable(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    from gapmap.research.academic_mode import run_academic_brief, get_academic_brief

    run_academic_brief("focus", level="L3")
    stored = get_academic_brief("focus")
    assert stored["ok"] is True
    assert stored["grounded_count"] == 3
    assert stored["citations"] == ["arxiv_0", "arxiv_1", "arxiv_2"]
    assert stored["markdown"].startswith("# Research Brief")


def test_evidence_post_ids_tolerates_both_shapes():
    # Regression: detect_gaps yields str post_ids; list_gaps yields {post_id} dicts.
    from gapmap.research.academic_mode import _evidence_post_ids
    assert _evidence_post_ids(["arxiv_1", "arxiv_2"]) == ["arxiv_1", "arxiv_2"]
    assert _evidence_post_ids([{"post_id": "openalex_W1"}, {"title": "no id"}]) == ["openalex_W1"]
    assert _evidence_post_ids([{"post_id": "x"}, "y", 42, None]) == ["x", "y"]
    assert _evidence_post_ids(None) == []


def test_integrity_block_flags_brief_but_still_returns_it(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    import gapmap.research.academic_integrity as ai
    # A blocking fabrication-mode finding hard-flags the brief.
    monkeypatch.setattr(ai, "run_integrity_check", lambda *a, **k: {
        "ok": True, "verdict": "FAIL", "blocking": True, "sampled": 3, "total": 3,
        "findings": [], "blocking_findings": [
            {"mode": "M3", "verdict": "suspected", "claim": "An unsupported result.",
             "note": "no source backs this result"}],
    })
    from gapmap.research.academic_mode import run_academic_brief

    r = run_academic_brief("focus", level="L3")
    assert r["ok"] is False               # integrity block fails the overall run
    assert r["gate"] == "integrity"
    assert r["gate_status"] == "blocked"
    assert r["brief"] is not None         # but the brief is still returned…
    # …and the flagged claim is surfaced in Acknowledged Limitations, never dropped.
    assert "integrity (M3)" in r["brief"]["markdown"]
    gates = _ledger_gates(acad_env, r["run_id"])
    assert gates["academic_integrity"] == 0


def test_citation_block_is_advisory_not_fatal(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    import gapmap.research.academic_citations as ac
    # A citation whose DOI did not resolve flags but does not erase the brief.
    monkeypatch.setattr(ac, "verify_citations", lambda post_ids, **k: {
        "ok": False, "total": len(post_ids), "verified": len(post_ids) - 1,
        "unresolvable": 0, "missing": 1, "blocking": True,
        "citations": [{"post_id": "arxiv_0", "identifier": "10.9/x",
                       "kind": "doi", "status": "missing", "title": "T"}],
    })
    from gapmap.research.academic_mode import run_academic_brief

    r = run_academic_brief("focus", level="L3")
    assert r["ok"] is True                 # citation miss is advisory (precision-over-recall)
    assert r["gate"] == "citation"
    assert r["gate_status"] == "flagged"
    assert r["citations_check"]["missing"] == 1
    assert "unverified citation" in r["brief"]["markdown"]


def test_on_stage_callback_streams_each_stage(acad_env, monkeypatch):
    _patch_pipeline(monkeypatch, grounded=3)
    from gapmap.research.academic_mode import run_academic_brief

    seen: list[str] = []
    run_academic_brief("focus", level="L3", on_stage=lambda stage, _p: seen.append(stage))
    for stage in ("research", "synthesize", "grounding", "peer_review", "finalize"):
        assert stage in seen
