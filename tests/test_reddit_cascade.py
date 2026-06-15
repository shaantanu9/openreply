"""Reddit tiered cascade: praw → cookie → rss, with proxy support."""
from __future__ import annotations

import pytest


@pytest.fixture
def _db(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db_mod.init_schema(db_mod.get_db())
    yield


def test_run_cascade_first_nonempty_wins():
    from gapmap.fetch import _reddit_tiers as rt
    rows, tier = rt.run_cascade([
        ("praw", lambda: []),
        ("cookie", lambda: [{"id": "1"}]),
        ("rss", lambda: [{"id": "2"}]),
    ])
    assert tier == "cookie" and rows[0]["id"] == "1"


def test_run_cascade_skips_raising_tier():
    from gapmap.fetch import _reddit_tiers as rt

    def boom():
        raise RuntimeError("403")

    rows, tier = rt.run_cascade([("cookie", boom), ("rss", lambda: [{"id": "r"}])])
    assert tier == "rss" and rows[0]["id"] == "r"


def test_run_cascade_all_empty_returns_none():
    from gapmap.fetch import _reddit_tiers as rt
    rows, tier = rt.run_cascade([("cookie", lambda: []), ("rss", lambda: [])])
    assert rows == [] and tier == "none"


def test_cookie_posts_skipped_without_cookie(_db, monkeypatch):
    from gapmap.fetch import _reddit_tiers as rt
    monkeypatch.setattr(rt._creds, "cookie_header", lambda *a, **k: "")
    assert rt.cookie_posts("python", "hot", 10, "day") == []


def test_search_uses_cookie_tier_when_present(_db, monkeypatch):
    import types

    from gapmap.fetch import _reddit_tiers as rt
    from gapmap.fetch import search as search_mod

    # Force public mode (no praw) and a present reddit cookie tier.
    monkeypatch.setattr(search_mod, "load_config",
                        lambda: types.SimpleNamespace(mode="public"))
    monkeypatch.setattr(rt, "cookie_search",
                        lambda *a, **k: [{"id": "c1", "source_type": "reddit", "title": "t"}])
    sentinel = {"hit": False}

    def rss_should_not_run(*a, **k):
        sentinel["hit"] = True
        return [{"id": "rss"}]

    monkeypatch.setattr(search_mod, "_search_public", rss_should_not_run)
    rows = search_mod.search_reddit("async", save=False)
    assert rows and rows[0]["id"] == "c1"
    assert sentinel["hit"] is False   # cookie tier served, RSS not reached


def test_proxy_read_from_env(monkeypatch):
    from gapmap.core import public_client as pc
    monkeypatch.setenv("REDDIT_PROXY", "http://127.0.0.1:8888")
    assert pc._proxy() == "http://127.0.0.1:8888"
