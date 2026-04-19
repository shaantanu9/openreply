"""End-to-end test for solutions_pipeline: mocks LLM + paper fetchers,
asserts the full graph chain (painpoint -> mechanism -> intervention ->
evidence_paper) is built for every painpoint."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from reddit_research.graph.schema import ensure_graph_schema, make_node_id


@pytest.fixture
def seeded_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    ensure_graph_schema()
    topic = "focus"
    pp = make_node_id(topic, "painpoint", "cant-focus")
    post = make_node_id(topic, "post", "p1")
    db["graph_nodes"].insert_all([
        {"id": pp, "topic": topic, "kind": "painpoint", "label": "Can't focus", "metadata_json": "{}"},
        {"id": post, "topic": topic, "kind": "post", "label": "p1", "metadata_json": "{}"},
    ], pk="id")
    db["graph_edges"].insert(
        {"src": pp, "dst": post, "kind": "evidenced_by", "topic": topic, "weight": 1.0, "metadata_json": "{}"},
        pk=("src", "dst", "kind"),
    )
    db["posts"].insert({
        "id": "p1", "sub": "x", "author": "a", "title": "Focus is hard", "selftext": "I keep getting distracted",
        "url": "", "score": 0, "upvote_ratio": None, "num_comments": 0, "created_utc": 0,
        "is_self": 1, "over_18": 0, "flair": None, "permalink": "", "fetched_at": "",
    }, pk="id", alter=True)
    return {"db": db, "topic": topic, "painpoint_id": pp}


def test_solutions_pipeline_builds_full_chain(
    monkeypatch: pytest.MonkeyPatch, seeded_db: dict,
) -> None:
    from reddit_research.research import science as sci_mod
    from reddit_research.research import solutions as sol_mod
    from reddit_research.research import why as why_mod

    # Mock LLM provider to return canned why + solution payloads in turn.
    class CannedProvider:
        def __init__(self):
            self.calls = 0
            self.responses = [
                # First call = why
                json.dumps({"emotions": ["fear"], "jtbd": {
                    "struggling_moment": "starting hard tasks", "anxiety": "won't finish", "desired_outcome": "deep work"}}),
                # Second call = solutions
                json.dumps({
                    "mechanism": "implementation intentions reduce switching cost",
                    "interventions": [{
                        "label": "Write next 3 actions on paper",
                        "confidence_tier": "peer-reviewed",
                        "effort": "low",
                        "supporting_paper_ids": ["pubmed_111"],
                        "rationale": "Gollwitzer 1999",
                    }],
                }),
            ]
        def complete(self, prompt, system, **kwargs):
            r = self.responses[self.calls]
            self.calls += 1
            return r

    canned = CannedProvider()
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: canned)
    monkeypatch.setattr(sol_mod, "get_provider", lambda _name=None: canned)

    # Mock paper fetchers
    monkeypatch.setattr(sci_mod, "fetch_pubmed", lambda q, limit=10: [
        {"id": "pubmed_111", "source_type": "pubmed", "title": "Implementation intentions",
         "selftext": "abstract...", "author": "Gollwitzer", "score": 100, "url": "http://x",
         "created_utc": 1500000000.0, "sub": "pubmed"},
    ])
    monkeypatch.setattr(sci_mod, "fetch_scholar", lambda q, limit=10: [])
    monkeypatch.setattr(sci_mod, "fetch_openalex", lambda q, limit=10: [])

    summary = sol_mod.solutions_pipeline(topic=seeded_db["topic"], provider="fake")

    assert summary["painpoints_processed"] == 1
    assert summary["why_extracted"] == 1
    assert summary["papers_persisted"] == 1
    assert summary["interventions_added"] == 1

    db = seeded_db["db"]
    pp = seeded_db["painpoint_id"]
    # Verify the full chain
    assert db["graph_nodes"].count_where("kind = 'evidence_paper'") == 1
    assert db["graph_nodes"].count_where("kind = 'mechanism'") == 1
    assert db["graph_nodes"].count_where("kind = 'intervention'") == 1
    assert db["graph_edges"].count_where("kind = 'has_evidence' AND src = ?", [pp]) == 1
    assert db["graph_edges"].count_where("kind = 'explained_by' AND src = ?", [pp]) == 1
    assert db["graph_edges"].count_where("kind = 'addressed_by'") == 1
    assert db["graph_edges"].count_where("kind = 'supported_by'") == 1
    # Why metadata merged into painpoint
    pp_row = db["graph_nodes"].get(pp)
    meta = json.loads(pp_row["metadata_json"])
    assert meta["why"]["emotions"] == ["fear"]
