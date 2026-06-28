"""End-to-end tests for Watch X Accounts: fetch_x_user + fetch_account pipeline.

Verifies the complete chain:
  bird subprocess JSON  →  _parse_bird_tweet  →  _row  →  fetch_account tagging
"""
from __future__ import annotations

import json
import subprocess
from unittest.mock import MagicMock, patch

import pytest

import openreply.sources.x_twitter as xt


# ---------------------------------------------------------------------------
# Bird-format tweet fixtures (matches mapTweetResult output from the JS lib)
# ---------------------------------------------------------------------------

def _bird_tweet(handle="naval", tweet_id="111", text="Ideas compound like interest.", likes=500, replies=12):
    return {
        "id": tweet_id,
        "text": text,
        "createdAt": "Mon Jan 01 10:00:00 +0000 2024",
        "likeCount": likes,
        "replyCount": replies,
        "retweetCount": 30,
        "conversationId": tweet_id,
        "author": {"username": handle, "name": handle.capitalize()},
        "authorId": "9876",
    }


# ---------------------------------------------------------------------------
# _parse_bird_tweet — unit-level field mapping
# ---------------------------------------------------------------------------

def test_parse_bird_tweet_url_constructed():
    """Bird tweets have no 'url' field — it must be built from author + id."""
    t = _bird_tweet(handle="naval", tweet_id="42")
    parsed = xt._parse_bird_tweet(t, 0)
    assert parsed is not None
    assert parsed["url"] == "https://x.com/naval/status/42"
    assert parsed["author_handle"] == "naval"


def test_parse_bird_tweet_engagement():
    t = _bird_tweet(likes=999, replies=77)
    parsed = xt._parse_bird_tweet(t, 0)
    assert parsed["likes"] == 999
    assert parsed["replies"] == 77


def test_parse_bird_tweet_created_at_parsed():
    t = _bird_tweet()
    parsed = xt._parse_bird_tweet(t, 0)
    # "Mon Jan 01 10:00:00 +0000 2024" → epoch
    assert parsed["created_utc"] > 0


def test_parse_bird_tweet_skips_missing_url_and_id():
    """Tweet with no id and no author → None (unfetchable)."""
    bad = {"text": "hello"}
    assert xt._parse_bird_tweet(bad, 0) is None


# ---------------------------------------------------------------------------
# _row — intermediate → corpus row mapping
# ---------------------------------------------------------------------------

def test_row_id_prefixed_with_x():
    parsed = xt._parse_bird_tweet(_bird_tweet(tweet_id="77"), 0)
    row = xt._row(parsed)
    assert row["id"] == "x_77"
    assert row["source_type"] == "x"
    assert row["sub"] == "x"


def test_row_text_becomes_title_and_selftext():
    text = "Wealth is created, not distributed."
    parsed = xt._parse_bird_tweet(_bird_tweet(text=text), 0)
    row = xt._row(parsed)
    assert row["selftext"] == text
    assert row["title"] == text[:200]


def test_row_score_and_comments():
    parsed = xt._parse_bird_tweet(_bird_tweet(likes=420, replies=13), 0)
    row = xt._row(parsed)
    assert row["score"] == 420
    assert row["num_comments"] == 13


def test_row_url_and_permalink_match():
    parsed = xt._parse_bird_tweet(_bird_tweet(handle="dharmesh", tweet_id="55"), 0)
    row = xt._row(parsed)
    assert row["url"] == "https://x.com/dharmesh/status/55"
    assert row["permalink"] == row["url"]


# ---------------------------------------------------------------------------
# fetch_x_user — subprocess mocking (bird --user path)
# ---------------------------------------------------------------------------

def _make_proc(tweets: list, returncode: int = 0):
    m = MagicMock()
    m.returncode = returncode
    m.stdout = json.dumps(tweets)
    m.stderr = ""
    return m


def test_fetch_x_user_bird_path(monkeypatch):
    """When node+bird present and AUTH_TOKEN set, uses bird --user and returns rows."""
    monkeypatch.setenv("AUTH_TOKEN", "tok")
    monkeypatch.setenv("CT0", "ct0val")
    monkeypatch.setattr(xt.shutil, "which", lambda x: "/usr/bin/node" if x == "node" else None)
    monkeypatch.setattr(xt, "_BIRD_MJS", MagicMock(exists=lambda: True))

    tweets = [_bird_tweet("naval", "100", "Productize yourself."), _bird_tweet("naval", "101", "Seek wealth not money.")]

    with patch("subprocess.run", return_value=_make_proc(tweets)):
        rows = xt.fetch_x_user("naval", limit=10)

    assert len(rows) == 2
    assert rows[0]["id"] == "x_100"
    assert rows[0]["source_type"] == "x"
    assert rows[0]["author"] == "naval"
    assert "Productize yourself" in rows[0]["selftext"]
    assert rows[0]["url"] == "https://x.com/naval/status/100"


def test_fetch_x_user_falls_back_on_bird_error(monkeypatch):
    """Bird returns non-zero → falls back to fetch_x (from: search)."""
    monkeypatch.setenv("AUTH_TOKEN", "tok")
    monkeypatch.setenv("CT0", "ct0val")
    monkeypatch.setattr(xt.shutil, "which", lambda x: "/usr/bin/node")
    monkeypatch.setattr(xt, "_BIRD_MJS", MagicMock(exists=lambda: True))

    fallback_row = {"id": "fb1", "author_handle": "naval", "text": "fallback",
                    "url": "https://x.com/naval/status/fb1", "likes": 1, "replies": 0, "created_utc": 0.0}
    monkeypatch.setattr(xt, "_fetch_bird", lambda q, n: [fallback_row])

    with patch("subprocess.run", return_value=_make_proc([], returncode=1)):
        rows = xt.fetch_x_user("naval", limit=5)

    assert rows and rows[0]["id"] == "x_fb1"


def test_fetch_x_user_no_node_uses_from_search(monkeypatch):
    """When node is absent, falls back to fetch_x from: search immediately."""
    monkeypatch.setenv("AUTH_TOKEN", "tok")
    monkeypatch.setenv("CT0", "ct0val")
    monkeypatch.setattr(xt.shutil, "which", lambda x: None)  # no node

    fallback_row = {"id": "s1", "author_handle": "jack", "text": "search fallback",
                    "url": "https://x.com/jack/status/s1", "likes": 5, "replies": 0, "created_utc": 0.0}
    monkeypatch.setattr(xt, "_fetch_bird", lambda q, n: [fallback_row])

    rows = xt.fetch_x_user("jack", limit=5)
    assert rows and rows[0]["source_type"] == "x"


def test_fetch_x_user_empty_handle_returns_empty(monkeypatch):
    monkeypatch.setenv("AUTH_TOKEN", "tok")
    assert xt.fetch_x_user("") == []
    assert xt.fetch_x_user("  ") == []


def test_fetch_x_user_bird_error_json(monkeypatch):
    """Bird returns {error: ..., items: []} → falls back cleanly."""
    monkeypatch.setenv("AUTH_TOKEN", "tok")
    monkeypatch.setenv("CT0", "ct0")
    monkeypatch.setattr(xt.shutil, "which", lambda x: "/usr/bin/node")
    monkeypatch.setattr(xt, "_BIRD_MJS", MagicMock(exists=lambda: True))
    monkeypatch.setattr(xt, "_fetch_bird", lambda q, n: [])
    monkeypatch.setattr(xt, "_fetch_xai", lambda q, n: [])
    monkeypatch.setattr(xt, "_fetch_xquik", lambda q, n: [])

    err_proc = MagicMock()
    err_proc.returncode = 0
    err_proc.stdout = json.dumps({"error": "No credentials", "items": []})

    with patch("subprocess.run", return_value=err_proc):
        rows = xt.fetch_x_user("nobody", limit=5)

    # Falls through to fetch_x which returns _error sentinel
    assert rows == [] or (len(rows) == 1 and "_error" in rows[0])


# ---------------------------------------------------------------------------
# fetch_account — full pipeline with mocked fetch_x_user
# ---------------------------------------------------------------------------

@pytest.fixture
def _agent_db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()
    db_mod.init_schema(db_mod.get_db())
    from openreply.reply.agent import create_agent
    create_agent(name="WatchTest", niche="productivity")
    yield


def test_fetch_account_tags_posts_into_corpus(_agent_db, monkeypatch):
    from openreply.sources import x_twitter as xt_mod
    from openreply.reply.accounts import fetch_account, track_account
    track_account("naval")

    # fetch_x_user is called inside accounts.py via a local import — patch at source
    monkeypatch.setattr(xt_mod, "fetch_x_user", lambda h, limit=50: [
        xt._row(xt._parse_bird_tweet(_bird_tweet("naval", str(i), f"Post {i}"), i))
        for i in range(3)
    ])

    r = fetch_account("naval")
    assert r["fetched"] == 3
    assert r["handle"] == "naval"
    assert r["platform"] == "x"
    assert len(r["sample"]) == 3
    assert "naval" in r["message"]


def test_fetch_account_surfaces_backend_error(_agent_db, monkeypatch):
    """When fetch_x_user returns only _error rows, message explains why."""
    import openreply.sources.x_twitter as xt_mod
    monkeypatch.setattr(xt_mod, "fetch_x_user",
                        lambda h, limit=50: [{"_error": "no X backend available — log into x.com"}])

    from openreply.reply.accounts import fetch_account
    r = fetch_account("nobody")
    assert r["fetched"] == 0
    assert "no X backend" in r["message"]


def test_fetch_account_no_posts_connect_hint(_agent_db, monkeypatch):
    """Empty result → message includes actionable connect hint."""
    import openreply.sources.x_twitter as xt_mod
    monkeypatch.setattr(xt_mod, "fetch_x_user", lambda h, limit=50: [])

    from openreply.reply.accounts import fetch_account
    r = fetch_account("ghost")
    assert r["fetched"] == 0
    assert "connect" in r["message"].lower() or "No posts" in r["message"]
