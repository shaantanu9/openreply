# tests/test_competitor_digest.py
from openreply.research.competitor_intel import digest_hook, registry

def test_competitor_moves_reads_snapshots(monkeypatch):
    registry.add_competitor("pdg", "Notion", daily_fetch=True)
    monkeypatch.setattr(digest_hook, "_latest",
        lambda pid, name: {"metrics": {"top_painpoints": ["sync"]},
                           "delta": {"new_complaints": 3, "sentiment_change": -0.1}})
    moves = digest_hook.competitor_moves("pdg")
    assert moves and moves[0]["competitor"] == "Notion"
    assert moves[0]["delta"]["new_complaints"] == 3
