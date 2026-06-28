"""Unit tests for the agent↔persona knowledge blend (reply/knowledge.py).

Covers the pure slot-allocation math and the DB-backed retrieval/blend:
no-persona fallback (corpus only), single + multi persona retrieval with
proportional allocation, graph-neighbor expansion, and belief (conclusion)
inclusion. Retrieval runs the keyword path (Chroma collection is empty in
tests → semantic returns None → keyword fallback), so results are
deterministic without a live embedding model.
"""
from __future__ import annotations

import time


# ── pure allocation math (no DB) ──────────────────────────────────────


def test_proportional_alloc_weighted_split():
    from openreply.reply.knowledge import proportional_alloc

    alloc = dict(proportional_alloc([(1, 2.0), (2, 1.0)], 6))
    assert alloc == {1: 4, 2: 2}
    assert sum(alloc.values()) == 6


def test_proportional_alloc_equal_weights():
    from openreply.reply.knowledge import proportional_alloc

    alloc = dict(proportional_alloc([(1, 1.0), (2, 1.0), (3, 1.0)], 6))
    assert alloc == {1: 2, 2: 2, 3: 2}


def test_proportional_alloc_single_persona_takes_all():
    from openreply.reply.knowledge import proportional_alloc

    assert proportional_alloc([(7, 1.0)], 6) == [(7, 6)]


def test_proportional_alloc_more_personas_than_slots_picks_top_weight():
    from openreply.reply.knowledge import proportional_alloc

    # k=2 < n=3 → only the two highest-weight personas get a slot each.
    alloc = dict(proportional_alloc([(1, 1.0), (2, 5.0), (3, 2.0)], 2))
    assert alloc == {1: 0, 2: 1, 3: 1}


# ── DB-backed fixtures ────────────────────────────────────────────────


def _fresh_db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core.db import get_db

    get_db.cache_clear()
    return get_db()


def _add_memory(db, *, mid, pid, lesson, excerpt="", topic="t", importance=0.9):
    db["persona_memories"].insert({
        "id": mid, "persona_id": pid, "source_post_id": f"p{mid}", "topic": topic,
        "lesson": lesson, "excerpt": excerpt, "tags": "[]",
        "importance": importance, "created_at": "2026-01-01T00:00:00+00:00",
    })


def _add_edge(db, *, pid, frm, to, weight=0.8):
    db["persona_edges"].insert({
        "persona_id": pid, "from_memory_id": frm, "to_memory_id": to,
        "kind": "relates_to", "weight": weight,
        "created_at": "2026-01-01T00:00:00+00:00",
    })


def _make_agent_with_personas(db, links):
    """links: [(persona_name, lens, weight)]. Returns (agent_id, [persona_id])."""
    from openreply.persona.store import create_persona
    from openreply.reply.agent import create_agent, link_persona

    a = create_agent(name="Acme", brand="Acme", niche="sleep tech", persona="founder")
    pids = []
    for name, lens, weight in links:
        res = create_persona(name, f"learn {lens}", lens)
        assert res.get("ok"), res
        pid = res["id"]
        pids.append(pid)
        link_persona(a["id"], pid, weight=weight)
    return a["id"], pids


# ── retrieve_for_agent + build_knowledge_context ──────────────────────


def test_no_linked_personas_yields_corpus_only(tmp_path, monkeypatch):
    db = _fresh_db(tmp_path, monkeypatch)
    from openreply.reply.agent import create_agent
    from openreply.reply.knowledge import build_knowledge_context, retrieve_for_agent

    a = create_agent(name="Solo", brand="Solo", niche="x")
    # Seed a topic corpus row the agent can fall back to.
    db["posts"].insert({"id": "po1", "title": "Sleep hygiene tips", "selftext": "wind down", "score": 99})
    db["topic_posts"].insert({"topic": a["topic"], "post_id": "po1"})

    assert retrieve_for_agent(a["id"], "anything") == []
    block = build_knowledge_context(a["id"], "anything", corpus_topic=a["topic"])
    assert "Sleep hygiene tips" in block
    assert "established beliefs" not in block  # no personas → no beliefs section


def test_single_persona_keyword_retrieval_is_lens_tagged(tmp_path, monkeypatch):
    db = _fresh_db(tmp_path, monkeypatch)
    from openreply.reply.knowledge import build_knowledge_context, retrieve_for_agent

    aid, (pid,) = _make_agent_with_personas(db, [("Sleep Doc", "sleep", 1.0)])
    _add_memory(db, mid=1, pid=pid, lesson="Consistent sleep schedule beats melatonin")
    _add_memory(db, mid=2, pid=pid, lesson="Unrelated note about taxes")

    mems = retrieve_for_agent(aid, "sleep schedule", k_mem=6)
    lessons = [m["lesson"] for m in mems]
    assert "Consistent sleep schedule beats melatonin" in lessons
    assert all(m["_persona"] == "Sleep Doc" and m["_lens"] == "sleep" for m in mems)

    block = build_knowledge_context(aid, "sleep schedule", corpus_topic=None)
    assert "[sleep lens]" in block
    assert "Consistent sleep schedule" in block


def test_two_personas_proportional_allocation(tmp_path, monkeypatch):
    db = _fresh_db(tmp_path, monkeypatch)
    from openreply.reply.knowledge import retrieve_for_agent

    aid, (pa, pb) = _make_agent_with_personas(
        db, [("A", "psychology", 2.0), ("B", "finance", 1.0)]
    )
    # 5 matching memories each; query "habit" hits all.
    for i in range(5):
        _add_memory(db, mid=10 + i, pid=pa, lesson=f"psychology habit insight {i}")
    for i in range(5):
        _add_memory(db, mid=20 + i, pid=pb, lesson=f"finance habit insight {i}")

    mems = retrieve_for_agent(aid, "habit", k_mem=6, neighbor_cap=0)
    from_a = [m for m in mems if m["_persona"] == "A"]
    from_b = [m for m in mems if m["_persona"] == "B"]
    # weight 2:1 over 6 slots → 4 from A, 2 from B
    assert len(from_a) == 4
    assert len(from_b) == 2


def test_graph_neighbor_expansion_included_and_tagged(tmp_path, monkeypatch):
    db = _fresh_db(tmp_path, monkeypatch)
    from openreply.reply.knowledge import retrieve_for_agent

    aid, (pid,) = _make_agent_with_personas(db, [("Doc", "sleep", 1.0)])
    _add_memory(db, mid=1, pid=pid, lesson="caffeine cutoff time matters")
    # mid=2 won't match the query directly, but is edge-linked to mid=1.
    _add_memory(db, mid=2, pid=pid, lesson="afternoon light exposure helps")
    _add_edge(db, pid=pid, frm=1, to=2, weight=0.9)

    mems = retrieve_for_agent(aid, "caffeine", k_mem=6, neighbor_cap=4)
    by_id = {m["id"]: m for m in mems}
    assert 1 in by_id and 2 in by_id
    assert by_id[1]["_neighbor"] is False
    assert by_id[2]["_neighbor"] is True  # pulled in as a graph neighbor


def test_beliefs_lead_the_knowledge_block(tmp_path, monkeypatch):
    db = _fresh_db(tmp_path, monkeypatch)
    from openreply.reply.knowledge import agent_beliefs, build_knowledge_context

    aid, (pid,) = _make_agent_with_personas(db, [("Doc", "sleep", 1.0)])
    _add_memory(db, mid=1, pid=pid, lesson="sleep regularity is the strongest lever")
    db["persona_conclusions"].insert({
        "persona_id": pid,
        "statement": "Regular sleep timing outperforms supplements for most people",
        "evidence_memory_ids": "[1]", "confidence": 0.82,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    })

    beliefs = agent_beliefs(aid, limit=3)
    assert beliefs and beliefs[0]["_lens"] == "sleep"

    block = build_knowledge_context(aid, "sleep", corpus_topic=None)
    # Beliefs section precedes the memories section.
    assert "established beliefs" in block
    assert block.index("established beliefs") < block.index("Related knowledge")
    assert "Regular sleep timing outperforms supplements" in block
