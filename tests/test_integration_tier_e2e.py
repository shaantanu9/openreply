"""End-to-end integration test for the Tier-1..6 build.

Exercises the full pipeline with synthetic data:
  seed posts → tag into topic → soft-delete → restore → clean-corpus
  dry-run → save a view → flag feedback → verify persistence.

If this fails on a fresh install, the app is broken. If it passes, a
user can at least touch every surface without a crash. It does NOT test
LLM-dependent steps (synthesize, extract_gaps) — those require a provider
key and are covered by ad-hoc QA.

Uses a unique-slug topic so it's safe to run against the real DB.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid

import pytest

from openreply.core.db import get_db, init_schema


@pytest.fixture(scope="module")
def db():
    d = get_db()
    init_schema(d)
    return d


@pytest.fixture
def test_topic():
    """Unique topic per test so we don't clobber real data."""
    t = f"_e2e_{uuid.uuid4().hex[:8]}"
    yield t
    # Teardown — nuke everything under this topic
    d = get_db()
    for tbl in ("topic_posts", "topic_prefs", "graph_nodes", "graph_edges",
                "finding_feedback", "saved_views", "topic_insights",
                "topic_runs", "hypothesis_tests"):
        if tbl not in d.table_names():
            continue
        try:
            if tbl == "saved_views":
                d.conn.execute("DELETE FROM saved_views WHERE scope = ?", [f"topic:{t}"])
            else:
                d.conn.execute(f"DELETE FROM {tbl} WHERE topic = ?", [t])
        except Exception:
            pass
    d.conn.commit()


def _seed_posts(db, topic: str, n: int = 5) -> list[str]:
    """Insert synthetic posts + tag into topic via topic_posts."""
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    post_ids = []
    for i in range(n):
        pid = f"{topic}_post_{i}"
        post_ids.append(pid)
        db["posts"].upsert(
            {
                "id": pid,
                "sub": f"test_{topic}",
                "source_type": "reddit",
                "author": f"user_{i}",
                "title": f"Test post {i} about {topic}",
                "selftext": "This is meaningful synthetic content for the e2e test. " * 5,
                "url": f"https://example.com/{pid}",
                "score": 5 + i,
                "upvote_ratio": 0.9,
                "num_comments": i * 2,
                "created_utc": 1_700_000_000 + i * 3600,
                "is_self": 1,
                "over_18": 0,
                "flair": "",
                "permalink": f"/r/test/{pid}",
                "fetched_at": now_iso,
            },
            pk="id",
        )
        db["topic_posts"].upsert(
            {
                "topic": topic,
                "post_id": pid,
                "source": "e2e_seed",
                "added_at": now_iso,
            },
            pk=("topic", "post_id"),
        )
    return post_ids


# ───────────────────────────────────────────────────────────────────────
# 1. Soft-delete round-trip
# ───────────────────────────────────────────────────────────────────────
def test_soft_delete_roundtrip(db, test_topic):
    from openreply.research.trash import soft_delete, restore, list_trash
    _seed_posts(db, test_topic, n=3)

    out = soft_delete(test_topic)
    assert out["ok"], f"soft_delete failed: {out}"
    assert out["hidden_posts"] == 3

    trash = list_trash()
    assert any(t["topic"] == test_topic for t in trash), \
        "soft-deleted topic should appear in trash"

    # Simulated list_topics filter — check deleted_at is non-empty
    row = next(db.query(
        "SELECT deleted_at FROM topic_prefs WHERE topic = ?", [test_topic]
    ))
    assert row["deleted_at"], "deleted_at should be stamped"

    restore(test_topic)
    row2 = next(db.query(
        "SELECT deleted_at FROM topic_prefs WHERE topic = ?", [test_topic]
    ))
    assert not row2["deleted_at"], "deleted_at should be cleared on restore"


# ───────────────────────────────────────────────────────────────────────
# 2. Clean-corpus dry-run runs cleanly
# ───────────────────────────────────────────────────────────────────────
def test_clean_corpus_dry_run(db, test_topic):
    from openreply.research.relevance import filter_topic_posts
    _seed_posts(db, test_topic, n=5)

    # Dry-run — must not touch the DB
    before = next(db.query(
        "SELECT count(*) AS n FROM topic_posts WHERE topic = ?", [test_topic]
    ))["n"]
    out = filter_topic_posts(test_topic, threshold=0.30, apply=False, min_keep=10)
    after = next(db.query(
        "SELECT count(*) AS n FROM topic_posts WHERE topic = ?", [test_topic]
    ))["n"]

    assert out.get("ok") or out.get("skipped"), f"clean_corpus returned: {out}"
    assert before == after, "dry-run must not mutate topic_posts"


# ───────────────────────────────────────────────────────────────────────
# 3. Saved views CRUD + filter evaluator
# ───────────────────────────────────────────────────────────────────────
def test_saved_views_crud(db, test_topic):
    from openreply.research.saved_views import create_view, list_views, apply_filter
    out = create_view(
        scope=f"topic:{test_topic}",
        name="High opportunity",
        filter_json=json.dumps({"min_opportunity_score": 15}),
        pinned=True,
    )
    assert out.get("id") or out.get("ok"), f"create_view returned: {out}"

    views = list_views(scope=f"topic:{test_topic}")
    assert len(views) >= 1, "saved view should be listable"

    # Apply filter against synthetic findings
    findings = [
        {"title": "high", "opportunity_score": 18, "kind": "painpoint"},
        {"title": "low",  "opportunity_score": 5,  "kind": "painpoint"},
    ]
    kept = apply_filter(findings, {"min_opportunity_score": 15})
    assert len(kept) == 1 and kept[0]["title"] == "high"


# ───────────────────────────────────────────────────────────────────────
# 4. Feedback record → prompt injection
# ───────────────────────────────────────────────────────────────────────
def test_feedback_roundtrip(db, test_topic):
    from openreply.research.feedback import record_feedback, feedback_for_prompt

    record_feedback(test_topic, "bogus pain", "painpoint", "wrong", "hallucination")
    record_feedback(test_topic, "off-topic pain", "painpoint", "off_topic", "")

    injected = feedback_for_prompt(test_topic)
    assert isinstance(injected, dict)

    # Flatten all string values for substring check.
    flat = json.dumps(injected)
    assert "bogus pain" in flat, "wrong-verdict feedback missing from prompt block"
    assert "off-topic pain" in flat, "off_topic-verdict feedback missing"


# ───────────────────────────────────────────────────────────────────────
# 5. Topic resolver find-existing + no auto-register
# ───────────────────────────────────────────────────────────────────────
def test_resolver_read_only_by_default(db, test_topic):
    from openreply.research.topic_resolver import (
        resolve_topic, find_existing_topic,
    )
    _seed_posts(db, test_topic, n=2)

    # Read-only resolve: must NOT auto-rewrite the input
    out = resolve_topic(test_topic.upper(), register=False)
    assert out == test_topic.upper(), \
        f"resolver should not auto-normalize; got {out}"

    # find_existing_topic SHOULD detect the case-variant duplicate
    match = find_existing_topic(test_topic.upper())
    assert match is not None, "find_existing_topic missed a case variant"
    assert match["existing_topic"].lower() == test_topic.lower()


# ───────────────────────────────────────────────────────────────────────
# 6. Quality gate diagnostic
# ───────────────────────────────────────────────────────────────────────
def test_quality_gate_counts(db, test_topic):
    from openreply.research.quality_gate import passes_quality
    _seed_posts(db, test_topic, n=5)

    rows = list(db.query(
        "SELECT p.id, p.title, p.selftext, p.score, p.author "
        "FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        "WHERE tp.topic = ?",
        [test_topic],
    ))
    lenient_pass = sum(1 for r in rows if passes_quality(dict(r), strict=False))
    strict_pass = sum(1 for r in rows if passes_quality(dict(r), strict=True))

    assert lenient_pass == len(rows), \
        "all seeded posts should pass lenient (score>=5, 50+ chars, non-bot author)"
    # Seeded content (~ 280 chars) + score >= 5 → also passes strict (>=100, >=3).
    assert strict_pass == len(rows)


# ───────────────────────────────────────────────────────────────────────
# 7. Graph dense-relations on a synthetic topic
# ───────────────────────────────────────────────────────────────────────
def test_dense_relations_graceful(db, test_topic):
    """Smoke-test: relations builder either runs or gracefully skips."""
    from openreply.graph.relations import build_semantic_relations
    # No semantic nodes yet → should skip cleanly
    out = build_semantic_relations(test_topic)
    assert out.get("ok"), f"relations returned not-ok: {out}"
    # Either "skipped" (< 2 findings) OR "edges_written" key present.
    assert out.get("skipped") or "edges_written" in out


# ───────────────────────────────────────────────────────────────────────
# 8. Prompt store override roundtrip (key isolated)
# ───────────────────────────────────────────────────────────────────────
def test_prompt_override_e2e():
    from openreply.research.prompt_store import get_prompt, set_prompt
    key = f"_e2e_{uuid.uuid4().hex[:8]}"
    try:
        def default_loader():
            return {"template": "bundled"}
        # No override → default
        r1 = get_prompt(key, default_loader=default_loader)
        assert r1 == {"template": "bundled"}
        # Set → read
        set_prompt(key, "template: override")
        r2 = get_prompt(key, default_loader=default_loader)
        if isinstance(r2, dict):
            assert r2.get("template") == "override"
        else:
            assert "override" in str(r2)
        # Clear
        set_prompt(key, "")
        r3 = get_prompt(key, default_loader=default_loader)
        assert r3 == {"template": "bundled"}
    finally:
        db = get_db()
        try:
            db.conn.execute("DELETE FROM prompt_overrides WHERE key = ?", [key])
            db.conn.commit()
        except Exception:
            pass


# ───────────────────────────────────────────────────────────────────────
# 9. Product-Mode CRUD sanity
# ───────────────────────────────────────────────────────────────────────
def test_product_create_list_delete():
    from openreply.research.product import (
        create_product, list_products, delete_product, get_product,
    )
    name = f"E2EProd_{uuid.uuid4().hex[:6]}"
    try:
        out = create_product(
            name=name, one_liner="e2e", category="test", topic="",
            competitors=[{"name": "Rival", "urls": {"website": "http://x"}}],
        )
        assert out["product"]["name"] == name
        pid = out["product"]["id"]

        lst = list_products(active_only=True)
        assert any(p["id"] == pid for p in lst)

        got = get_product(pid)
        assert got["ok"]
        assert len(got["competitors"]) == 1

        delete_product(pid)
        lst2 = list_products(active_only=True)
        assert not any(p["id"] == pid for p in lst2), \
            "product should be gone from active list"
    finally:
        db = get_db()
        try:
            db.conn.execute("DELETE FROM products WHERE name = ?", [name])
            db.conn.execute(
                "DELETE FROM product_competitors "
                "WHERE product_id IN (SELECT id FROM products WHERE name = ?)",
                [name])
            db.conn.commit()
        except Exception:
            pass
