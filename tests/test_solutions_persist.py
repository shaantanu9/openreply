"""Unit tests for research.persist_solutions — graph upserts for the
new node kinds (mechanism, intervention, evidence_paper) and edges
(explained_by, addressed_by, supported_by, has_evidence)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from openreply.graph.schema import ensure_graph_schema, make_node_id


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    ensure_graph_schema()
    # Seed a topic + 1 painpoint
    topic = "focus"
    pp_id = make_node_id(topic, "painpoint", "cant-focus")
    db["graph_nodes"].insert(
        {"id": pp_id, "topic": topic, "kind": "painpoint", "label": "Can't focus", "metadata_json": "{}"},
        pk="id",
    )
    return db


def test_persist_why_merges_into_painpoint_metadata(db) -> None:
    from openreply.research.persist_solutions import persist_why_for_painpoint

    persist_why_for_painpoint(
        topic="focus",
        painpoint_id=make_node_id("focus", "painpoint", "cant-focus"),
        why={"emotions": ["fear"], "jtbd": {"struggling_moment": "x", "anxiety": "y", "desired_outcome": "z"}},
    )

    row = db["graph_nodes"].get(make_node_id("focus", "painpoint", "cant-focus"))
    meta = json.loads(row["metadata_json"])
    assert meta["why"]["emotions"] == ["fear"]
    assert meta["why"]["jtbd"]["desired_outcome"] == "z"


def test_persist_papers_creates_evidence_nodes_and_edges(db) -> None:
    from openreply.research.persist_solutions import persist_papers_for_painpoint

    pp = make_node_id("focus", "painpoint", "cant-focus")
    n = persist_papers_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        papers=[
            {"id": "pubmed_111", "title": "Paper A", "selftext": "abs A", "url": "http://a", "tier": "peer-reviewed",
             "author": "Smith", "created_utc": 1700000000.0, "source_type": "pubmed"},
            {"id": "scholar_222", "title": "Paper B", "selftext": "abs B", "url": "http://b", "tier": "peer-reviewed",
             "author": "Jones", "created_utc": 1700000000.0, "source_type": "scholar"},
        ],
    )

    assert n == 2
    papers_in_db = list(db["graph_nodes"].rows_where("kind = 'evidence_paper' AND topic = 'focus'"))
    assert len(papers_in_db) == 2
    edges = list(db["graph_edges"].rows_where("kind = 'has_evidence' AND src = ?", [pp]))
    assert len(edges) == 2


def test_persist_solutions_creates_mechanism_intervention_chain(db) -> None:
    from openreply.research.persist_solutions import (
        persist_papers_for_painpoint,
        persist_solutions_for_painpoint,
    )

    pp = make_node_id("focus", "painpoint", "cant-focus")
    persist_papers_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        papers=[{"id": "pubmed_111", "title": "Paper A", "selftext": "abs", "url": "", "tier": "peer-reviewed",
                 "author": "Smith", "created_utc": 1700000000.0, "source_type": "pubmed"}],
    )

    summary = persist_solutions_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        solution={
            "mechanism": "implementation intentions reduce switching cost",
            "interventions": [
                {
                    "label": "Write next 3 actions on paper",
                    "confidence_tier": "peer-reviewed",
                    "effort": "low",
                    "supporting_paper_ids": ["pubmed_111"],
                    "rationale": "Gollwitzer 1999",
                },
            ],
        },
    )

    assert summary["mechanisms_added"] == 1
    assert summary["interventions_added"] == 1
    assert summary["supporting_edges"] == 1

    # Mechanism node exists, edge painpoint --explained_by--> mechanism
    mechs = list(db["graph_nodes"].rows_where("kind = 'mechanism' AND topic = 'focus'"))
    assert len(mechs) == 1
    expl = list(db["graph_edges"].rows_where("kind = 'explained_by' AND src = ?", [pp]))
    assert len(expl) == 1
    # Intervention node exists, edge mechanism --addressed_by--> intervention
    intvs = list(db["graph_nodes"].rows_where("kind = 'intervention' AND topic = 'focus'"))
    assert len(intvs) == 1
    addr = list(db["graph_edges"].rows_where("kind = 'addressed_by'"))
    assert len(addr) == 1
    # Edge intervention --supported_by--> evidence_paper
    sup = list(db["graph_edges"].rows_where("kind = 'supported_by'"))
    assert len(sup) == 1


def test_persist_solutions_skipped_input_no_op(db) -> None:
    from openreply.research.persist_solutions import persist_solutions_for_painpoint

    pp = make_node_id("focus", "painpoint", "cant-focus")
    summary = persist_solutions_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        solution={"_skipped": True, "reason": "no_papers"},
    )
    assert summary == {"mechanisms_added": 0, "interventions_added": 0, "supporting_edges": 0}
