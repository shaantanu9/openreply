"""Regression: agent whose topic canonicalized must still see its corpus.

Root cause (2026-07-01): collection tags posts under the LLM-canonicalized topic
via `_tag_posts`, but the agent record keeps the raw typed topic. Reads that
queried `topic_posts` with the raw topic matched zero rows → blank Daily Update,
Library, chat, counts. `agent_corpus_topic()` resolves the read to the canonical.
"""
import time

from openreply.core.db import get_db, upsert_posts
from openreply.reply import agent as A
from openreply.reply.agent import agent_corpus_topic
from openreply.reply.library import list_corpus
from openreply.reply import digest as D
from openreply.research.topic_resolver import register_alias


def _seed_post(pid: str, topic: str, title: str):
    upsert_posts([{
        "id": pid, "sub": "test", "source_type": "gnews", "author": "a",
        "title": title, "selftext": "body about software delivery",
        "url": f"https://x/{pid}", "score": 10, "upvote_ratio": None,
        "num_comments": 0, "created_utc": time.time(), "is_self": 1,
        "over_18": 0, "flair": None, "permalink": None,
        "fetched_at": "2026-07-01T00:00:00+00:00",
    }])
    db = get_db()
    db["topic_posts"].insert({"topic": topic, "post_id": pid,
                              "source": "test", "added_at": "2026-07-01"},
                             pk=("topic", "post_id"), replace=True)


def test_list_corpus_follows_canonical_topic():
    raw = "AI-powered software development and engineering services XYZ"
    canonical = "AI-powered software development services XYZ"
    register_alias(raw, canonical)
    _seed_post("res_p1", canonical, "Faster software delivery for teams")
    _seed_post("res_p2", canonical, "Engineering velocity tips")

    a = A.create_agent(name="ResolveCo", niche=raw, make_active=True)
    assert a["topic"] == raw            # agent stores the raw typed topic
    assert agent_corpus_topic(a) == canonical
    res = list_corpus(a["id"], limit=10)
    ids = {it["id"] for it in res["items"]}
    assert {"res_p1", "res_p2"} <= ids, "corpus read must follow the canonical topic"
    assert res["total"] >= 2


def test_cache_serviceable_only_when_content_or_empty_corpus():
    db = get_db()
    # empty feed + empty corpus → serviceable (nothing better to build)
    a_empty = A.create_agent(name="EmptyCorpusCo",
                             niche="totally-unseen-topic-abc", make_active=False)
    assert D._cache_serviceable({"feed": [], "briefing": None}, db, a_empty) is True
    # has content → serviceable
    assert D._cache_serviceable({"feed": [{"x": 1}], "briefing": None}, db, a_empty) is True
    # empty feed while corpus HAS posts → NOT serviceable (bug signature → rebuild)
    register_alias("cache-raw-topic", "cache-canon-topic")
    _seed_post("res_p3", "cache-canon-topic", "delivery post")
    a_full = A.create_agent(name="FullCorpusCo",
                            niche="cache-raw-topic", make_active=False)
    assert D._cache_serviceable({"feed": [], "briefing": None}, db, a_full) is False
