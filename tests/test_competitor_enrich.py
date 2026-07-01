from openreply.research.competitor_intel import enrich


def test_enrich_seed_parses_llm(monkeypatch):
    def fake_llm(prompt, provider=None):
        return ('{"aliases":["notion.so","@NotionHQ"],'
                '"subreddits":["Notion"],'
                '"urls":{"producthunt":"https://www.producthunt.com/products/notion"},'
                '"category":"productivity"}')
    monkeypatch.setattr(enrich, "_call_llm", fake_llm)
    out = enrich.enrich_seed("Notion")
    assert "notion.so" in out["aliases"]
    assert out["subreddits"] == ["Notion"]
    assert out["urls"]["producthunt"].startswith("https://")
    assert out["category"] == "productivity"

def test_enrich_seed_degrades_on_error(monkeypatch):
    def boom(prompt, provider=None):
        raise RuntimeError("no key")
    monkeypatch.setattr(enrich, "_call_llm", boom)
    out = enrich.enrich_seed("Whatever")
    assert out == {"aliases": [], "subreddits": [], "urls": {}, "category": ""}


def test_enrich_seed_strips_subreddit_prefix_not_chars(monkeypatch):
    def fake_llm(prompt, provider=None):
        return '{"subreddits":["r/rust","r/Notion"],"aliases":[],"urls":{},"category":""}'
    monkeypatch.setattr(enrich, "_call_llm", fake_llm)
    out = enrich.enrich_seed("Rust")
    assert out["subreddits"] == ["rust", "Notion"]   # NOT ["ust", ...]
