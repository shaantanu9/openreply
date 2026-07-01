"""Deterministic peer-entity extraction (ported from last30days competitors.py)."""
from openreply.sources._peer_entities import extract_peer_entities


def _item(title, snippet, author="example.com"):
    return {"title": title, "selftext": snippet, "author": author, "sub": author}


def test_extracts_real_competitors_and_ranks_by_frequency():
    items = [
        _item("10 Best Notion Alternatives in 2026", "Obsidian and Airtable lead the pack.", "techrepublic.com"),
        _item("Notion vs Obsidian vs Airtable", "Obsidian is great for notes; Airtable for databases.", "g2.com"),
        _item("Top Notion competitors", "Coda and Obsidian are popular choices.", "cloudwards.net"),
    ]
    out = extract_peer_entities(items, "Notion", limit=10)
    assert "Obsidian" in out            # appears 3× → top
    assert "Airtable" in out
    assert "Coda" in out
    # Obsidian is most frequent, so it ranks first.
    assert out[0] == "Obsidian"


def test_excludes_topic_itself():
    items = [_item("Notion review", "Notion is a great Notion workspace", "x.com")]
    assert "Notion" not in extract_peer_entities(items, "Notion")


def test_excludes_publishers_and_stopwords_and_domains():
    items = [
        _item("Best Alternatives — Compare Features and Pricing",
              "Read the full comparison on Thurrott.com and Cloudwards.net",
              "techrepublic.com"),
    ]
    out = extract_peer_entities(items, "Notion", limit=10)
    for junk in ("TechRepublic", "Compare", "Features", "Pricing",
                 "Thurrott.com", "Cloudwards.net", "Best Alternatives"):
        assert junk not in out, f"{junk!r} should be filtered out"


def test_empty_items_returns_empty():
    assert extract_peer_entities([], "Notion") == []
