import os, tempfile
os.environ.setdefault("OPENREPLY_DATA_DIR", tempfile.mkdtemp())


def test_build_digest_fail_soft_no_llm():
    """No LLM / empty corpus → ok:true, briefing None, feed list, never raises."""
    from openreply.reply import agent as A, digest as D
    a = A.create_agent(name="DigestCo", niche="note taking", make_active=True)
    r = D.build_digest(a["id"], collect_fresh=False)
    assert r["ok"] is True
    assert r["briefing"] is None
    assert isinstance(r["feed"], list)


def test_digest_cached_same_day():
    """Second call (rebuild=False) returns the same day's cached row."""
    from openreply.reply import agent as A, digest as D
    a = A.create_agent(name="DigestCo2", niche="ci tools", make_active=True)
    first = D.build_digest(a["id"], collect_fresh=False)
    second = D.build_digest(a["id"], collect_fresh=False)
    assert second["cached"] is True
    assert second["day"] == first["day"]


def test_digest_rebuild_upserts_for_day():
    """rebuild=True re-runs the build (cached:false) and keeps one row per day."""
    from openreply.reply import agent as A, digest as D
    from openreply.reply.schema import init_reply_schema
    a = A.create_agent(name="DigestCo3", niche="rust", make_active=True)
    D.build_digest(a["id"], collect_fresh=False)
    again = D.build_digest(a["id"], rebuild=True, collect_fresh=False)
    assert again["cached"] is False
    db = init_reply_schema()
    rows = list(db["reply_digest"].rows_where("agent_id = ? AND day = ?",
                                              [a["id"], again["day"]]))
    assert len(rows) == 1


def test_category_of_maps_sources():
    """source_type strings resolve to the four feed categories, prefix-tolerant."""
    from openreply.reply.digest import _category_of
    assert _category_of("gnews") == "news"
    assert _category_of("duckduckgo") == "news"
    assert _category_of("rss_tech_news") == "news"
    assert _category_of("devto") == "articles"
    assert _category_of("github_trending") == "articles"
    assert _category_of("hackernews") == "articles"
    assert _category_of("lemmy") == "community"
    assert _category_of("mastodon") == "community"
    assert _category_of("arxiv") == "research"
    assert _category_of("scholar:transformers") == "research"
    assert _category_of("") == "news"  # safe default


def test_search_news_empty_query():
    """Empty query is rejected without touching the network."""
    from openreply.reply import digest as D
    r = D.search_news(query="   ")
    assert r["ok"] is False and r["results"] == []


def test_build_digest_feed_items_have_category():
    """Every feed item carries a category in {news,articles,community,research}."""
    from openreply.reply import agent as A, digest as D
    a = A.create_agent(name="DigestCo4", niche="llm agents", make_active=True)
    r = D.build_digest(a["id"], collect_fresh=False)
    cats = {"news", "articles", "community", "research"}
    assert all(it.get("category") in cats for it in r["feed"])
