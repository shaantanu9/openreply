"""FSD Fleet Phase 1 — topic debate orchestrator tests.

Runs the heuristic path (no LLM): deliberate() falls back to tiering by
evidence/mention signals, so these tests are deterministic and offline.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENREPLY_SKIP_PALACE", "1")
    # Force the heuristic (no-LLM) path deterministically, regardless of any
    # provider keys present in the dev/CI environment. deliberate() resolves
    # the provider inside a try/except, so making resolution raise drops it to
    # the offline heuristic tiering.
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    import openreply.analyze.providers.base as prov_base

    def _no_provider(*_a, **_k):
        raise RuntimeError("forced offline for test")

    monkeypatch.setattr(prov_base, "resolve_provider", _no_provider)
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    d = db_mod.get_db()
    db_mod.init_schema(d)
    return d


def _seed_topic(db, topic="focus"):
    findings = [
        {"title": "Users cannot focus during long sessions",
         "evidence": "Many report losing focus after 30 minutes of deep work today.",
         "mention_count": 8, "supporting_post_ids": ["t3_a", "t3_b", "t3_c"]},
        {"title": "No way to export notes",
         "evidence": "Export missing.", "mention_count": 1,
         "supporting_post_ids": ["t3_d"]},
        {"title": "Sync conflicts lose data across devices frequently reported",
         "evidence": "Sync drops edits when two devices are online at once daily.",
         "mention_count": 5, "supporting_post_ids": ["t3_e", "t3_f"]},
    ]
    report = {"ok": True, "topic": topic, "findings": findings}
    from openreply.research import insights
    insights._ensure_topic_insights_table()
    db["topic_insights"].upsert(
        {"topic": topic, "report_json": json.dumps(report),
         "generated_at": "2026-06-14T00:00:00+00:00", "corpus_size": 10,
         "provider": "", "model": ""},
        pk="topic",
    )
    # A graph node whose label matches finding #1 exactly.
    db["graph_nodes"].insert(
        {"id": "n_focus", "topic": topic, "kind": "painpoint",
         "label": "Users cannot focus during long sessions",
         "metadata_json": "{}", "ts": "", "evidence_post_id": "", "provenance": ""},
        pk="id",
    )
    return topic, findings


def test_needs_synthesis_when_no_findings(db):
    from openreply.research.debate_run import run_topic_debate
    out = run_topic_debate("empty-topic")
    assert out["ok"] is False
    assert out["reason"] == "needs_synthesis"


def test_debate_writes_verdicts_and_node_cache(db):
    from openreply.research.debate_run import run_topic_debate, get_debate_verdicts
    topic, findings = _seed_topic(db)

    out = run_topic_debate(topic, rounds=1)
    assert out["ok"] is True
    assert out["n_verdicts"] == len(findings)
    # No LLM available → heuristic fallback path.
    assert out["provenance"] == "llm_fallback"
    assert sum(out["counts"].values()) == len(findings)

    # One verdict row per finding, all tiers valid.
    rows = list(db.query("SELECT * FROM debate_verdicts WHERE topic = ?", [topic]))
    assert len(rows) == len(findings)
    assert all(r["tier"] in {"confirmed", "probable", "minority", "discarded"} for r in rows)
    assert all(r["findings_hash"] == out["findings_hash"] for r in rows)

    # The matching node got its render-cache columns stamped.
    node = list(db.query("SELECT debate_tier, consensus_score FROM graph_nodes WHERE id = 'n_focus'"))[0]
    assert node["debate_tier"] in {"confirmed", "probable", "minority", "discarded"}

    # Lineage + checks rows were recorded.
    assert list(db.query("SELECT COUNT(*) c FROM lineage WHERE topic = ? AND artifact_kind = 'debate_verdict'", [topic]))[0]["c"] == len(findings)
    assert list(db.query("SELECT COUNT(*) c FROM checks_ledger WHERE topic = ? AND gate = 'debate_consensus'", [topic]))[0]["c"] == len(findings)

    # debate_runs row closed.
    run = list(db.query("SELECT status FROM debate_runs WHERE run_id = ?", [out["run_id"]]))[0]
    assert run["status"] == "done"

    # Reader returns verdicts, not stale against current findings.
    rd = get_debate_verdicts(topic)
    assert rd["ok"] is True
    assert len(rd["verdicts"]) == len(findings)
    assert rd["stale"] is False
    assert rd["verdicts"][0]["evidence_count"] >= 1


def test_staleness_flips_when_findings_change(db):
    from openreply.research.debate_run import run_topic_debate, get_debate_verdicts
    topic, _ = _seed_topic(db)
    run_topic_debate(topic, rounds=1)
    assert get_debate_verdicts(topic)["stale"] is False

    # Mutate the cached findings → hash changes → verdicts go stale.
    report = {"ok": True, "topic": topic, "findings": [
        {"title": "A brand new finding nobody debated yet", "mention_count": 3,
         "supporting_post_ids": ["t3_z"]},
    ]}
    db["topic_insights"].upsert(
        {"topic": topic, "report_json": json.dumps(report),
         "generated_at": "2026-06-14T01:00:00+00:00", "corpus_size": 11,
         "provider": "", "model": ""},
        pk="topic",
    )
    assert get_debate_verdicts(topic)["stale"] is True


def test_audit_payload_after_debate(db):
    from openreply.research.debate_run import run_topic_debate, get_debate_audit
    topic, findings = _seed_topic(db)
    out = run_topic_debate(topic, rounds=1)

    audit = get_debate_audit(topic)
    assert audit["ok"] is True
    assert audit["run"] is not None
    assert audit["run"]["run_id"] == out["run_id"]
    assert audit["run"]["status"] == "done"
    # Heuristic path emits no LLM transcript, but counts + provenance gates persist.
    assert audit["counts"]["n_findings"] == len(findings)
    assert audit["checks"] == len(findings)        # one debate_consensus gate per finding
    assert audit["lineage"] == len(findings)        # one debate_verdict lineage row per finding


def test_budget_status_levels():
    from openreply.research.debate_run import _budget_status
    import os
    os.environ.pop("OPENREPLY_DEBATE_TOKEN_BUDGET", None)
    assert _budget_status(5000)["level"] == "none"      # no budget configured
    os.environ["OPENREPLY_DEBATE_TOKEN_BUDGET"] = "1000"
    try:
        assert _budget_status(100)["level"] == "ok"
        assert _budget_status(800)["level"] == "warning"
        assert _budget_status(950)["level"] == "critical"
        assert _budget_status(1200)["level"] == "exceeded"
        assert _budget_status(1200)["pct"] == 1.2
    finally:
        os.environ.pop("OPENREPLY_DEBATE_TOKEN_BUDGET", None)


def test_cost_and_transcript_with_fake_provider(db, monkeypatch):
    # Inject a fake LLM provider so the real persona-vote path runs (also guards
    # the persona_conclusions fix) and produces a token estimate + transcript.
    import openreply.analyze.providers.base as prov_base

    class _FakeProv:
        def complete(self, *, prompt, system, max_tokens=1800, temperature=0.4):
            # Vote CONFIRM on indices 0..9; the parser drops out-of-range ones.
            return "[" + ",".join(
                f'{{"i":{i},"vote":"CONFIRM","rationale":"looks solid"}}' for i in range(10)
            ) + "]"

    monkeypatch.setattr(prov_base, "resolve_provider", lambda *_a, **_k: "fake")
    monkeypatch.setattr(prov_base, "get_provider", lambda *_a, **_k: _FakeProv())

    from openreply.research.debate_run import run_topic_debate, get_debate_audit
    topic, findings = _seed_topic(db)
    out = run_topic_debate(topic, rounds=1)

    assert out["ok"] is True
    assert out["provenance"] == "debated"          # LLM path, not fallback
    assert out["cost_tokens"] > 0                    # estimated tokens accumulated
    assert out["budget"]["level"] == "none"          # no budget env set

    audit = get_debate_audit(topic)
    assert audit["run"]["cost_tokens"] > 0
    assert len(audit["transcript"]) > 0              # per-persona votes recorded
    assert audit["transcript"][0]["persona"] in {
        "synthesizer", "skeptic", "quantifier", "risk_officer", "devils_advocate"}

    # With a tiny budget, the same cost trips 'exceeded'.
    monkeypatch.setenv("OPENREPLY_DEBATE_TOKEN_BUDGET", "1")
    assert get_debate_audit(topic)["budget"]["level"] == "exceeded"


def test_dynamic_roles_fallback_offline(db):
    # Offline (no provider): generate_debate_roles falls back to the fixed panel,
    # and a dynamic-roles debate still completes via the heuristic path.
    from openreply.research.deliberate import generate_debate_roles, PERSONAS
    roles = generate_debate_roles("anything", n=5)
    assert roles == PERSONAS                       # fallback when no LLM
    from openreply.research.debate_run import run_topic_debate
    topic, findings = _seed_topic(db)
    out = run_topic_debate(topic, rounds=1, dynamic_roles=True)
    assert out["ok"] is True
    assert out["n_verdicts"] == len(findings)


def test_dynamic_roles_used_when_provided(db, monkeypatch):
    # With a fake provider, generate_debate_roles returns a custom panel and
    # deliberate runs over it (persona keys come from the generated roles).
    import openreply.analyze.providers.base as prov_base

    class _Roles:
        def complete(self, *, prompt, system, max_tokens=900, temperature=0.5):
            if "review panel" in system:        # role-generation call
                return ('[{"key":"economist","name":"Economist","bias":"cost-obsessed","focus":"unit economics"},'
                        '{"key":"ux","name":"UX Lead","bias":"user-first","focus":"friction"},'
                        '{"key":"contra","name":"Contrarian","bias":"challenges majority","focus":"groupthink"}]')
            return '[{"i":0,"vote":"CONFIRM","rationale":"ok"},{"i":1,"vote":"DISPUTE","rationale":"no"},{"i":2,"vote":"ABSTAIN","rationale":"meh"}]'

    monkeypatch.setattr(prov_base, "resolve_provider", lambda *a, **k: "fake")
    monkeypatch.setattr(prov_base, "get_provider", lambda *a, **k: _Roles())

    from openreply.research.deliberate import generate_debate_roles
    roles = generate_debate_roles("note apps", n=3)
    assert {r["key"] for r in roles} == {"economist", "ux", "contra"}

    from openreply.research.debate_run import run_topic_debate, get_debate_audit
    topic, _ = _seed_topic(db)
    out = run_topic_debate(topic, rounds=1, dynamic_roles=True)
    assert out["ok"] is True
    personas = set(out["personas_used"])
    assert personas and personas <= {"economist", "ux", "contra"}


def test_redebate_replaces_prior_verdicts(db):
    from openreply.research.debate_run import run_topic_debate
    topic, findings = _seed_topic(db)
    run_topic_debate(topic, rounds=1)
    run_topic_debate(topic, rounds=1)
    # clear_debate_verdicts runs each time → no duplicate accumulation.
    rows = list(db.query("SELECT COUNT(*) c FROM debate_verdicts WHERE topic = ?", [topic]))
    assert rows[0]["c"] == len(findings)
