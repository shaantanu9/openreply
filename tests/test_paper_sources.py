from gapmap.research.sources import ACADEMIC_SOURCES, is_academic_source

def test_academic_set_exact():
    assert ACADEMIC_SOURCES == frozenset(
        {"arxiv", "pubmed", "openalex", "scholar", "semantic_scholar", "crossref"}
    )

def test_is_academic_source():
    assert is_academic_source("arxiv") is True
    assert is_academic_source("ArXiv") is True          # case-insensitive
    assert is_academic_source("reddit") is False
    assert is_academic_source("appstore") is False
    assert is_academic_source("playstore") is False
    assert is_academic_source("hackernews") is False
    assert is_academic_source(None) is False
    assert is_academic_source("") is False


def test_chunk_paper_skips_non_academic(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core.db import get_db, init_schema
    db = get_db(); init_schema(db)
    db["posts"].insert({"id": "r1", "title": "rant", "selftext": "x" * 4000,
                        "source_type": "reddit"}, pk="id")
    from gapmap.research.paper_chunks import chunk_paper
    out = chunk_paper("r1", embed=True)
    assert out.get("skipped") == "non_academic_source"
    assert out["embedded"] == 0
