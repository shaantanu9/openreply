from openreply.analyze import sentiment

def test_sentiment_by_source_aggregates(monkeypatch):
    posts = [
        {"source_type": "appstore", "title": "hate the price", "selftext": ""},
        {"source_type": "appstore", "title": "love it", "selftext": ""},
        {"source_type": "reddit_free", "title": "meh okay", "selftext": ""},
    ]
    monkeypatch.setattr(sentiment, "_corpus_for", lambda topic, limit: posts)
    # Deterministic fake classifier: -1 if "hate", +1 if "love", else 0
    def fake_batch(texts, provider=None):
        out = []
        for t in texts:
            out.append(-1.0 if "hate" in t else 1.0 if "love" in t else 0.0)
        return out
    monkeypatch.setattr(sentiment, "classify_batch", fake_batch)

    res = sentiment.sentiment_by_source("competitor:x")
    assert res["by_source"]["appstore"]["n"] == 2
    assert res["by_source"]["appstore"]["pos"] == 1
    assert res["by_source"]["appstore"]["neg"] == 1
    assert res["by_source"]["appstore"]["score"] == 0.0
    assert res["by_source"]["reddit_free"]["neu"] == 1
    assert -1.0 <= res["overall"] <= 1.0
