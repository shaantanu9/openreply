"""Unit tests for sources.gummysearch_import — import shapes + presets."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db_mod.get_db()
    return tmp_path


def test_import_json_list_of_audiences(env):
    from openreply.sources import gummysearch_import as g
    p = env / "exp.json"
    p.write_text(json.dumps([
        {"name": "SaaS founders", "subreddits": ["r/SaaS", "/r/startups", "indiehackers"]},
        {"name": "Fitness", "subreddits": ["Fitness", "loseit"]},
    ]))
    r = g.import_file(str(p))
    assert r["ok"] and r["imported"] == 2
    lst = g.list_audiences()
    names = {a["name"] for a in lst["rows"]}
    assert "SaaS founders" in names
    # r/ prefix stripped + deduped.
    saas = next(a for a in lst["rows"] if a["name"] == "SaaS founders")
    assert "SaaS" in saas["subreddits"] and "startups" in saas["subreddits"]
    assert all(not s.lower().startswith("r/") for s in saas["subreddits"])


def test_import_json_flat_list(env):
    from openreply.sources import gummysearch_import as g
    p = env / "flat.json"
    p.write_text(json.dumps(["r/webdev", "programming"]))
    r = g.import_file(str(p))
    assert r["ok"] and r["imported"] == 1
    assert r["audiences"][0]["count"] == 2


def test_import_csv(env):
    from openreply.sources import gummysearch_import as g
    p = env / "exp.csv"
    p.write_text("name,subreddit\nMy Audience,r/SaaS\nMy Audience,startups\nOther,fitness\n")
    r = g.import_file(str(p))
    assert r["ok"]
    by_name = {a["name"]: a for a in r["audiences"]}
    assert by_name["My Audience"]["count"] == 2
    assert by_name["Other"]["count"] == 1


def test_presets_and_add_preset(env):
    from openreply.sources import gummysearch_import as g
    pr = g.presets()
    assert pr["ok"] and pr["count"] > 0
    keys = {p["key"] for p in pr["presets"]}
    assert "saas" in keys
    added = g.import_preset("saas")
    assert added["ok"] and added["audience"]["count"] > 0
    assert g.import_preset("bogus")["ok"] is False


def test_missing_file_graceful(env):
    from openreply.sources import gummysearch_import as g
    assert g.import_file(str(env / "nope.json"))["ok"] is False
