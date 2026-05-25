"""Smoke tests — DB schema + exporters. No network, no Reddit creds needed."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlite_utils import Database

from gapmap.core.db import (
    init_schema,
    log_fetch_end,
    log_fetch_start,
    upsert_comments,
    upsert_posts,
)
from gapmap.core.exporters import export_rows


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Database:
    # Redirect the module-level singleton to this temp DB.
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core import db as db_mod

    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    from gapmap.core.config import load_config  # noqa: F401

    return db_mod.get_db()


def test_schema_created(db: Database) -> None:
    expected = {
        "posts",
        "comments",
        "users",
        "subreddits",
        "fetches",
        "streams",
        "stream_hits",
    }
    assert expected.issubset(set(db.table_names()))


def test_upsert_posts_and_comments(db: Database) -> None:
    upsert_posts(
        [
            {
                "id": "p1",
                "sub": "test",
                "author": "alice",
                "title": "hi",
                "selftext": "",
                "url": "",
                "score": 1,
                "upvote_ratio": 1.0,
                "num_comments": 0,
                "created_utc": 0,
                "is_self": 1,
                "over_18": 0,
                "flair": None,
                "permalink": "",
                "fetched_at": "2026-04-18T00:00:00+00:00",
            }
        ]
    )
    upsert_comments(
        [
            {
                "id": "c1",
                "post_id": "p1",
                "parent_id": "t3_p1",
                "author": "bob",
                "body": "nice",
                "score": 2,
                "created_utc": 1,
                "depth": 0,
                "fetched_at": "2026-04-18T00:00:00+00:00",
            }
        ]
    )
    # Idempotent upsert
    upsert_posts(
        [
            {
                "id": "p1",
                "sub": "test",
                "author": "alice",
                "title": "hi edited",
                "selftext": "",
                "url": "",
                "score": 5,
                "upvote_ratio": 1.0,
                "num_comments": 1,
                "created_utc": 0,
                "is_self": 1,
                "over_18": 0,
                "flair": None,
                "permalink": "",
                "fetched_at": "2026-04-18T00:01:00+00:00",
            }
        ]
    )
    assert db["posts"].count == 1
    assert db["comments"].count == 1
    assert db["posts"].get("p1")["title"] == "hi edited"


def test_fetch_audit_log(db: Database) -> None:
    fid = log_fetch_start("posts", {"sub": "x"})
    log_fetch_end(fid, rows=3)
    row = db["fetches"].get(fid)
    assert row["rows"] == 3
    assert row["ended_at"] is not None


def test_export_json_string() -> None:
    out = export_rows([{"a": 1, "b": "x"}], out_path=None, fmt="json")
    assert json.loads(out) == [{"a": 1, "b": "x"}]


def test_export_csv_file(tmp_path: Path) -> None:
    p = tmp_path / "out.csv"
    export_rows([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}], out_path=p, fmt="csv")
    text = p.read_text()
    assert "a,b" in text
    assert "1,x" in text and "2,y" in text
