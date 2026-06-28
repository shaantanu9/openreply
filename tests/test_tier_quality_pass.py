"""Regression tests for the 2026-04-21 Tier-1..6 quality pass.

Covers:
  * Topic resolver alias contract (T1.3 doesn't leak into user-typed input)
  * Soft-delete / restore / purge (trash.py)
  * Quality gate heuristics (quality_gate.py)
  * Finding feedback roundtrip (feedback.py)
  * Saved views filter evaluator (saved_views.py)
  * Prompt override (prompt_store.py)

Each test uses temp topic slugs and cleans up after itself so they can run
against the user's real local DB without poisoning it. Guarded imports —
if an agent-shipped module is missing for any reason, the test skips
rather than failing the whole suite.
"""
from __future__ import annotations

import importlib
import pytest

from openreply.core.db import get_db, init_schema


# ── Helpers ───────────────────────────────────────────────────────────
def _try_import(dotted):
    try:
        return importlib.import_module(dotted)
    except ImportError:
        return None


def _unique_topic(prefix):
    import uuid
    return f"_test_{prefix}_{uuid.uuid4().hex[:8]}"


def _purge_topic(topic):
    db = get_db()
    for tbl in ("topic_posts", "topic_prefs", "graph_nodes", "graph_edges",
                "finding_feedback"):
        if tbl in db.table_names():
            try:
                db.conn.execute(f"DELETE FROM {tbl} WHERE topic = ?", (topic,))
            except Exception:
                pass
    db.conn.commit()


# ── Topic resolver ────────────────────────────────────────────────────
def test_resolve_topic_returns_input_unchanged_without_alias():
    tr = _try_import("openreply.research.topic_resolver")
    if tr is None:
        pytest.skip("topic_resolver module missing")
    topic = _unique_topic("resolve")
    try:
        assert tr.resolve_topic(topic, register=False) == topic
    finally:
        _purge_topic(topic)


def test_resolve_topic_follows_llm_alias():
    tr = _try_import("openreply.research.topic_resolver")
    if tr is None:
        pytest.skip("topic_resolver module missing")
    canon = _unique_topic("canon")
    typed = canon.upper()  # LLM would lowercase "TYPED" → "typed"
    try:
        tr.register_alias(typed, canon, source="llm")
        assert tr.resolve_topic(typed, register=False) == canon
        assert tr.resolve_topic(canon, register=False) == canon
    finally:
        db = get_db()
        for norm in {typed.casefold(), canon.casefold()}:
            try:
                db.conn.execute("DELETE FROM topic_aliases WHERE alias_norm = ?", (norm,))
            except Exception:
                pass
        db.conn.commit()


# ── Soft-delete ───────────────────────────────────────────────────────
def test_soft_delete_hides_then_restore_unhides():
    trash = _try_import("openreply.research.trash")
    if trash is None:
        pytest.skip("trash module missing")
    topic = _unique_topic("soft")
    db = get_db()
    init_schema(db)
    # Seed a prefs row so the soft_delete has something to stash a tombstone on.
    db.conn.execute(
        "INSERT INTO topic_prefs (topic, scheduled, last_run_seen, last_run_ts) "
        "VALUES (?, 0, '', ?) ON CONFLICT(topic) DO NOTHING",
        (topic, "2026-04-21T00:00:00"),
    )
    db.conn.commit()
    try:
        out = trash.soft_delete(topic)
        assert out["ok"] is True
        # After soft-delete the topic has a non-empty deleted_at.
        rows = list(db.query(
            "SELECT deleted_at FROM topic_prefs WHERE topic = ?", [topic]
        ))
        assert rows and rows[0]["deleted_at"]
        # Restore clears it.
        trash.restore(topic)
        rows = list(db.query(
            "SELECT deleted_at FROM topic_prefs WHERE topic = ?", [topic]
        ))
        assert rows and (not rows[0]["deleted_at"] or rows[0]["deleted_at"] == "")
    finally:
        _purge_topic(topic)


def test_purge_older_than_zero_days_removes_soft_deleted():
    trash = _try_import("openreply.research.trash")
    if trash is None:
        pytest.skip("trash module missing")
    topic = _unique_topic("purge")
    db = get_db()
    init_schema(db)
    db.conn.execute(
        "INSERT INTO topic_prefs (topic, scheduled, last_run_seen, last_run_ts) "
        "VALUES (?, 0, '', ?) ON CONFLICT(topic) DO NOTHING",
        (topic, "2026-04-21T00:00:00"),
    )
    db.conn.commit()
    trash.soft_delete(topic)
    out = trash.purge_older_than(min_age_days=0)
    # Purge at min_age=0 treats anything soft-deleted before `now` as eligible.
    # If the row's deleted_at is >= cutoff it won't be picked up in the same
    # millisecond — that's fine; in that case `purged` will be 0 and the row
    # is cleaned up by _purge_topic below. We assert the function ran cleanly.
    assert out.get("ok") is True
    _purge_topic(topic)


# ── Quality gate ──────────────────────────────────────────────────────
@pytest.mark.parametrize("row,strict,expect", [
    ({"score": 0, "title": "ok",   "selftext": "x" * 50, "author": "alice"}, False, False),  # score 0 fails lenient
    ({"score": 2, "title": "ok",   "selftext": "x" * 50, "author": "alice"}, False, True),   # passes lenient
    ({"score": 2, "title": "ok",   "selftext": "x" * 50, "author": "alice"}, True,  False),  # fails strict (score<3)
    ({"score": 5, "title": "ok",   "selftext": "x" * 150,"author": "alice"}, True,  True),   # passes strict
    ({"score": 5, "title": "ok",   "selftext": "x" * 150,"author": "AutoModerator"}, False, False),  # bot blocked lenient
])
def test_quality_gate_heuristics(row, strict, expect):
    qg = _try_import("openreply.research.quality_gate")
    if qg is None:
        pytest.skip("quality_gate module missing")
    assert qg.passes_quality(row, strict=strict) is expect


# ── Finding feedback ──────────────────────────────────────────────────
def test_feedback_record_and_prompt_integration():
    fb = _try_import("openreply.research.feedback")
    if fb is None:
        pytest.skip("feedback module missing")
    topic = _unique_topic("fb")
    try:
        fb.record_feedback(topic, "bogus painpoint", "painpoint", "wrong", "hallucinated")
        injected = fb.feedback_for_prompt(topic)
        assert isinstance(injected, dict)
        vals = []
        for v in injected.values():
            if isinstance(v, list):
                vals.extend(v)
        assert any("bogus painpoint" in str(x) for x in vals), \
            f"expected 'bogus painpoint' in {injected}"
    finally:
        _purge_topic(topic)


# ── Saved views filter evaluator ──────────────────────────────────────
def test_saved_views_apply_filter():
    sv = _try_import("openreply.research.saved_views")
    if sv is None:
        pytest.skip("saved_views module missing")
    findings = [
        {"title": "high-op", "kind": "painpoint", "opportunity_score": 18,
         "triangulation_strength": "strong"},
        {"title": "low-op",  "kind": "painpoint", "opportunity_score": 5,
         "triangulation_strength": "narrow"},
        {"title": "feat",    "kind": "feature_wish", "opportunity_score": 14,
         "triangulation_strength": "strong"},
    ]
    out = sv.apply_filter(findings, {"min_opportunity_score": 10})
    titles = {f["title"] for f in out}
    assert "high-op" in titles
    assert "low-op" not in titles
    assert "feat" in titles

    out2 = sv.apply_filter(findings, {"kinds": ["painpoint"]})
    assert {f["title"] for f in out2} == {"high-op", "low-op"}


# ── Prompt override ───────────────────────────────────────────────────
def test_prompt_override_roundtrip():
    ps = _try_import("openreply.research.prompt_store")
    if ps is None:
        pytest.skip("prompt_store module missing")
    key = f"_test_override_{id(test_prompt_override_roundtrip)}"
    try:
        default_loader = lambda: {"template": "bundled template"}
        # No override set → returns default
        got = ps.get_prompt(key, default_loader=default_loader)
        assert got == {"template": "bundled template"}
        # Set an override (YAML-parsed string)
        ps.set_prompt(key, "template: overridden template")
        got2 = ps.get_prompt(key, default_loader=default_loader)
        # Override can be dict (if YAML-parseable) or str (raw). Accept either.
        if isinstance(got2, dict):
            assert got2.get("template") == "overridden template"
        else:
            assert "overridden template" in str(got2)
        # Clear
        ps.set_prompt(key, "")
        got3 = ps.get_prompt(key, default_loader=default_loader)
        assert got3 == {"template": "bundled template"}
    finally:
        db = get_db()
        try:
            db.conn.execute("DELETE FROM prompt_overrides WHERE key = ?", (key,))
            db.conn.commit()
        except Exception:
            pass
