# tests/test_competitor_compare.py
from openreply.research.competitor_intel import compare, registry


def test_build_comparison(monkeypatch):
    registry.add_competitor("pc", "Notion")
    registry.add_competitor("pc", "Obsidian")
    monkeypatch.setattr(compare, "_product_topic", lambda pid: "myprod")
    monkeypatch.setattr(compare, "_sentiment",
        lambda topic, provider: {"overall": 0.3, "by_source": {}})
    snaps = {
        "Notion": {"metrics": {"sentiment_score": -0.2, "complaint_count": 10,
                               "top_painpoints": ["sync"], "mentions_by_source": {"a": 6}}},
        "Obsidian": {"metrics": {"sentiment_score": 0.1, "complaint_count": 4,
                                 "top_painpoints": ["mobile"], "mentions_by_source": {"a": 4}}},
    }
    monkeypatch.setattr(compare, "_latest", lambda pid, name: snaps.get(name))
    out = compare.build_comparison("pc")
    assert out["you"]["sentiment"] == 0.3
    names = {c["name"] for c in out["competitors"]}
    assert names == {"Notion", "Obsidian"}
    notion = next(c for c in out["competitors"] if c["name"] == "Notion")
    assert notion["complaint_count"] == 10
    # share_of_voice sums to ~1 across competitors
    assert abs(sum(c["share_of_voice"] for c in out["competitors"]) - 1.0) < 1e-6
