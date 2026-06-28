"""FSD Fleet Phase 4 — flow orchestration tests (offline / heuristic)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENREPLY_SKIP_PALACE", "1")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    import openreply.analyze.providers.base as prov_base
    monkeypatch.setattr(prov_base, "resolve_provider",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline")))
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    d = db_mod.get_db()
    db_mod.init_schema(d)
    return d


def _seed(db, topic="focus", n_posts=60, sources=("reddit", "hn", "arxiv")):
    # corpus with multiple sources → decision gate should say 'complex'
    posts, tps = [], []
    for i in range(n_posts):
        src = sources[i % len(sources)]
        pid = f"{src}_{i}"
        posts.append({"id": pid, "source_type": src, "title": f"post {i}", "selftext": "x"})
        tps.append({"topic": topic, "post_id": pid})
    db["posts"].insert_all(posts, pk="id", alter=True)
    db["topic_posts"].insert_all(tps, pk=("topic", "post_id"), alter=True)
    # cached findings so synthesize reuses (no LLM)
    from openreply.research import insights
    insights._ensure_topic_insights_table()
    rep = {"ok": True, "topic": topic, "findings": [
        {"title": "Cannot focus during long sessions", "evidence": "loses focus after 30 min today",
         "mention_count": 8, "supporting_post_ids": ["reddit_0", "hn_1"]},
        {"title": "No export option", "evidence": "export missing", "mention_count": 2,
         "supporting_post_ids": ["arxiv_2"]},
    ]}
    db["topic_insights"].upsert(
        {"topic": topic, "report_json": json.dumps(rep), "generated_at": "x",
         "corpus_size": n_posts, "provider": "", "model": ""}, pk="topic")
    return topic


def test_decision_gate_complex_vs_simple(db):
    from openreply.research.fleet_flow import decision_gate
    topic = _seed(db)
    g = decision_gate(topic)
    assert g["mode"] == "complex"             # 60 posts, 3 sources, findings
    assert g["signals"]["source_count"] >= 2
    # an empty topic is simple
    assert decision_gate("nothing")["mode"] == "simple"


def test_plan_routes_recommends_by_gate(db):
    from openreply.research.fleet_flow import plan_routes
    topic = _seed(db)
    p = plan_routes(topic)
    assert {r["key"] for r in p["routes"]} == {"quick", "standard", "deep"}
    assert p["recommended"] == "deep"
    rec = [r for r in p["routes"] if r["recommended"]]
    assert len(rec) == 1 and rec[0]["key"] == "deep"
    assert all("est_cost_tokens" in r for r in p["routes"])


def test_run_fleet_flow_standard_route(db):
    from openreply.research.fleet_flow import run_fleet_flow, get_fleet_status
    topic = _seed(db)
    seen = []
    out = run_fleet_flow(topic, route="standard", on_stage=lambda s: seen.append(s["name"]))
    assert out["ok"] is True
    assert out["route"] == "standard"
    names = [s["name"] for s in out["stages"]]
    assert names == ["clarify_check", "synthesize", "debate", "audit"]
    # synthesize reuses cached findings; debate runs (heuristic); audit ok
    by = {s["name"]: s["status"] for s in out["stages"]}
    assert by["synthesize"] == "reused"
    assert by["debate"] == "ok"
    assert by["audit"] == "ok"
    assert seen == names                       # streaming callback fired per stage

    # persisted + readable
    st = get_fleet_status(topic)
    assert st["run"]["route"] == "standard"
    assert st["run"]["status"] == "done"
    assert len(st["run"]["stages"]) == 4


def test_default_route_follows_gate(db):
    from openreply.research.fleet_flow import run_fleet_flow
    topic = _seed(db)
    out = run_fleet_flow(topic)               # no route → gate says complex → deep
    assert out["route"] == "deep"
    assert out["stages"][0]["name"] == "clarify_check"


def test_autopilot_l1_suggest_runs_nothing(db):
    from openreply.research.fleet_flow import run_fleet_flow
    topic = _seed(db)
    out = run_fleet_flow(topic, level="L1")
    assert out["status"] == "suggested"
    assert out["stages"] == []                # L1 executes nothing
    assert out["plan"]["routes"]              # but returns the plan


def test_autopilot_l2_gates_before_expensive_stage(db):
    from openreply.research.fleet_flow import run_fleet_flow
    topic = _seed(db)
    out = run_fleet_flow(topic, route="standard", level="L2")
    assert out["status"] == "waiting_approval"
    assert out["next_stage"] == "debate"      # standard: clarify+synthesize ran, paused before debate
    done = [s["name"] for s in out["stages"]]
    assert "clarify_check" in done and "synthesize" in done and "debate" not in done
    assert "debate" in out["pending_stages"]

    # Approving runs the full route (done stages reuse cheaply).
    approved = run_fleet_flow(topic, route="standard", level="L2", approved=True)
    assert approved["status"] == "done"
    assert [s["name"] for s in approved["stages"]] == ["clarify_check", "synthesize", "debate", "audit"]


def test_autopilot_l2_deep_gates_before_ground(db):
    from openreply.research.fleet_flow import run_fleet_flow
    topic = _seed(db)
    out = run_fleet_flow(topic, route="deep", level="L2")
    assert out["status"] == "waiting_approval"
    assert out["next_stage"] == "ground"      # deep: gated before ground


def test_fleet_command_decomposes_directive(db):
    from openreply.research.fleet_flow import fleet_command
    _seed(db)
    # offline → heuristic split on 'and'
    out = fleet_command("note taking apps and task managers", execute=False)
    assert out["ok"] is True
    topics = [m["topic"] for m in out["missions"]]
    assert len(topics) == 2
    assert all("plan" in m for m in out["missions"])   # planned, not executed
    assert out["executed"] is False
