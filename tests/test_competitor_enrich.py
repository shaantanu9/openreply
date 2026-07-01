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
