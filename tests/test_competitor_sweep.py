from openreply.research.competitor_intel import sweep, registry


def test_run_competitor_sweep_end_to_end(monkeypatch):
    registry.add_competitor("psw", "Notion", subreddits=["Notion"])

    monkeypatch.setattr(sweep, "_collect",
        lambda topic, sources, keywords, provider, progress: {"posts_fetched": 12})
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"label": "slow sync", "evidence_post_ids": ["p1"], "severity": 0.8}],
        "product_complaints": [{"label": "expensive", "evidence_post_ids": ["p2"]}],
        "feature_wishes": [{"label": "offline mode", "evidence_post_ids": ["p3"]}],
    })
    monkeypatch.setattr(sweep, "_enrich_graph", lambda topic: None)
    monkeypatch.setattr(sweep, "_sentiment", lambda topic, provider: {
        "overall": -0.4, "by_source": {"appstore": {"score": -0.4, "n": 5,
                                                     "pos": 1, "neg": 3, "neu": 1}}})

    out = sweep.run_competitor_sweep("psw", "Notion")
    assert out["ok"] is True
    assert out["posts_fetched"] == 12
    assert out["findings"] >= 2          # complaint + feature_gap written
    assert out["opportunities"] >= 1     # feature wish → competitor_vulnerability
    assert out["snapshot_id"]
    snap = sweep.latest_snapshot("psw", "Notion")
    assert snap["metrics"]["sentiment_score"] == -0.4


def test_sweep_computes_delta_on_second_run(monkeypatch):
    registry.add_competitor("psd", "X")
    monkeypatch.setattr(sweep, "_collect",
        lambda *a, **k: {"posts_fetched": 3})
    monkeypatch.setattr(sweep, "_enrich_graph", lambda topic: None)
    monkeypatch.setattr(sweep, "_sentiment",
        lambda topic, provider: {"overall": 0.0, "by_source": {}})
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"label": "a", "evidence_post_ids": ["1"]}]})
    sweep.run_competitor_sweep("psd", "X")
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"label": "a", "evidence_post_ids": ["1"]},
                       {"label": "b", "evidence_post_ids": ["2"]}]})
    out = sweep.run_competitor_sweep("psd", "X")
    assert out["delta"]["new_complaints"] >= 1
