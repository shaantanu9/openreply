"""Unit tests for Research Mode backend — reading status + highlights
(`research.paper_reading`), collections + library (`research.paper_library`),
and the lit-matrix non-LLM paths (`research.lit_matrix`).

No LLM provider is needed: these cover CRUD, queue/counts, the unified library
view, and the matrix's JSON parser + read/export on an empty matrix.
"""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENREPLY_SKIP_PALACE", "1")  # no vector writes in unit tests
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    from openreply.research.collect import _ensure_topics_table
    _ensure_topics_table()
    # Seed 3 academic papers under one topic.
    topic = "binaural beats"
    for i, src in enumerate(("arxiv", "pubmed", "openalex")):
        pid = f"{src}_{i}"
        db["posts"].insert(
            {"id": pid, "title": f"Paper {i} on beats", "selftext": "abstract text",
             "source_type": src, "score": 10 - i, "created_utc": 1_600_000_000,
             "url": f"https://example.org/{pid}", "author": "Smith, J."},
            pk="id", alter=True,
        )
        db["topic_posts"].insert(
            {"topic": topic, "post_id": pid, "source": f"{src}:test", "added_at": "now"},
            pk=("topic", "post_id"),
        )
    return db


TOPIC = "binaural beats"


# ─── paper_reading ───────────────────────────────────────────────────────────
def test_reading_status_roundtrip(db) -> None:
    from openreply.research import paper_reading as pr
    assert pr.get_status("arxiv_0")["status"] == "to_read"  # default
    assert pr.set_status("arxiv_0", "reading")["ok"]
    assert pr.get_status("arxiv_0")["status"] == "reading"
    assert pr.set_status("arxiv_0", "read")["status"] == "read"
    assert pr.get_status("arxiv_0")["status"] == "read"


def test_reading_status_rejects_bad_value(db) -> None:
    from openreply.research import paper_reading as pr
    assert pr.set_status("arxiv_0", "bogus")["ok"] is False


def test_reading_queue_and_counts(db) -> None:
    from openreply.research import paper_reading as pr
    # All 3 are implicitly to_read for the topic.
    assert pr.reading_queue(TOPIC)["count"] == 3
    pr.set_status("arxiv_0", "read")
    assert pr.reading_queue(TOPIC)["count"] == 2
    counts = pr.status_counts(TOPIC)["counts"]
    assert counts["read"] == 1 and counts["reading"] == 0


def test_highlights_crud(db) -> None:
    from openreply.research import paper_reading as pr
    r = pr.add_highlight("arxiv_0", section="results", char_start=5, char_end=20,
                         quote="theta rises", note="key", color="green")
    hid = r["highlight"]["id"]
    assert pr.list_highlights("arxiv_0")["count"] == 1
    pr.update_highlight(hid, note="updated")
    assert pr.list_highlights("arxiv_0")["highlights"][0]["note"] == "updated"
    # topic_notes surfaces it
    assert pr.topic_notes(TOPIC)["count"] == 1
    pr.delete_highlight(hid)
    assert pr.list_highlights("arxiv_0")["count"] == 0


def test_highlight_same_span_is_idempotent(db) -> None:
    from openreply.research import paper_reading as pr
    pr.add_highlight("pubmed_1", section="methods", char_start=0, char_end=10, quote="abc")
    pr.add_highlight("pubmed_1", section="methods", char_start=0, char_end=10, quote="abc again")
    assert pr.list_highlights("pubmed_1")["count"] == 1  # same span → one row


def test_read_view_shape(db) -> None:
    from openreply.research import paper_reading as pr
    v = pr.read_view("arxiv_0")
    assert v["ok"] and v["title"] and v["status"] == "to_read"
    assert isinstance(v["sections"], list) and v["sections"]
    assert v["tier"] in ("full_text", "abstract")


# ─── paper_library ───────────────────────────────────────────────────────────
def test_collections_and_membership(db) -> None:
    from openreply.research import paper_library as pl
    c = pl.create_collection("Week 1")
    cid = c["id"]
    assert pl.list_collections()["count"] == 1
    assert pl.add_to_collection(cid, "arxiv_0")["ok"]
    assert pl.collections_for_post("arxiv_0") == [cid]
    assert pl.list_collections()["collections"][0]["count"] == 1
    # filter library by collection
    assert pl.library(collection_id=cid)["count"] == 1
    pl.remove_from_collection(cid, "arxiv_0")
    assert pl.library(collection_id=cid)["count"] == 0
    pl.delete_collection(cid)
    assert pl.list_collections()["count"] == 0


def test_library_lists_all_topic_papers(db) -> None:
    from openreply.research import paper_library as pl
    lib = pl.library()
    assert lib["count"] == 3
    assert {p["post_id"] for p in lib["papers"]} == {"arxiv_0", "pubmed_1", "openalex_2"}


def test_library_status_filter(db) -> None:
    from openreply.research import paper_reading as pr
    from openreply.research import paper_library as pl
    pr.set_status("arxiv_0", "read")
    assert pl.library(status="read")["count"] == 1
    assert pl.library(status="to_read")["count"] == 2


# ─── lit_matrix (non-LLM paths) ──────────────────────────────────────────────
def test_lit_matrix_parse() -> None:
    from openreply.research import lit_matrix as lm
    assert lm._parse('{"method": "x"}')["method"] == "x"
    assert lm._parse('```json\n{"method": "y"}\n```')["method"] == "y"
    assert lm._parse("noise {\"method\": \"z\"} tail")["method"] == "z"
    assert lm._parse("not json at all") is None


def test_lit_matrix_empty_read_and_export(db) -> None:
    from openreply.research import lit_matrix as lm
    got = lm.get(TOPIC)
    assert got["ok"] and got["count"] == 0 and got["fields"] == lm.FIELDS
    csv = lm.export_csv(TOPIC)
    assert csv["ok"] and csv["csv"].splitlines()[0] == "title,method,dataset,sample,findings,limitations,metric"


# ─── flow_status ─────────────────────────────────────────────────────────────
def test_flow_status_shape_and_progress(db) -> None:
    from openreply.research.flow_status import flow_status
    from openreply.research import paper_reading as pr
    fs = flow_status(TOPIC)
    assert fs["ok"] and fs["papers"] == 3
    assert fs["stages"]["gather"] == 1.0
    assert fs["stages"]["read"] == 0.0 and fs["to_read"] == 3
    # marking one read moves the read stage off zero
    pr.set_status("arxiv_0", "read")
    fs2 = flow_status(TOPIC)
    assert fs2["read"] == 1 and fs2["stages"]["read"] > 0 and fs2["to_read"] == 2


def test_flow_status_empty_topic(db) -> None:
    from openreply.research.flow_status import flow_status
    fs = flow_status("nonexistent topic")
    assert fs["ok"] and fs["papers"] == 0 and fs["stages"]["gather"] == 0.0
