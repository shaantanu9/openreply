# tests/test_competitor_registry.py
from openreply.research.competitor_intel import registry as R

def test_slugify():
    assert R._slugify("Notion Labs!") == "notion-labs"
    assert R._slugify("  Obsidian.md ") == "obsidian-md"

def test_competitor_topic():
    assert R.competitor_topic("notion") == "competitor:notion"

def test_add_and_get_competitor():
    R.add_competitor("prod1", "Notion", website="https://notion.so",
                     aliases=["notion.so"], subreddits=["Notion"])
    c = R.get_competitor("prod1", "Notion")
    assert c is not None
    assert c["slug"] == "notion"
    assert c["topic"] == "competitor:notion"
    assert c["aliases"] == ["notion.so"]
    assert c["subreddits"] == ["Notion"]
    assert c["source_config"]["enabled_adapters"] == R.DEFAULT_SOURCE_PACK
    assert c["status"] == "active"

def test_list_competitors():
    R.add_competitor("prodL", "A")
    R.add_competitor("prodL", "B")
    rows = R.list_competitors("prodL")
    assert {r["competitor_name"] for r in rows} == {"A", "B"}

def test_list_competitors_active_only():
    R.add_competitor("prodF", "X")
    rows = R.list_competitors(active_only=True)
    assert any(r["competitor_name"] == "X" for r in rows)
